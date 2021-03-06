// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @implements {UI.ContextFlavorListener}
 * @unrestricted
 */
Sources.JavaScriptBreakpointsSidebarPane = class extends UI.VBox {
  constructor() {
    super();
    this.registerRequiredCSS('components/breakpointsList.css');

    this._breakpointManager = Bindings.breakpointManager;

    this._listElement = createElementWithClass('ol', 'breakpoint-list');

    this.emptyElement = this.element.createChild('div', 'gray-info-message');
    this.emptyElement.textContent = Common.UIString('No Breakpoints');

    this._items = new Map();

    var breakpointLocations = this._breakpointManager.allBreakpointLocations();
    for (var i = 0; i < breakpointLocations.length; ++i)
      this._addBreakpoint(breakpointLocations[i].breakpoint, breakpointLocations[i].uiLocation);

    this._breakpointManager.addEventListener(
        Bindings.BreakpointManager.Events.BreakpointAdded, this._breakpointAdded, this);
    this._breakpointManager.addEventListener(
        Bindings.BreakpointManager.Events.BreakpointRemoved, this._breakpointRemoved, this);

    this.emptyElement.addEventListener('contextmenu', this._emptyElementContextMenu.bind(this), true);
    this._breakpointManager.addEventListener(
        Bindings.BreakpointManager.Events.BreakpointsActiveStateChanged, this._breakpointsActiveStateChanged, this);
    this._breakpointsActiveStateChanged();
    this._update();
  }

  _emptyElementContextMenu(event) {
    var contextMenu = new UI.ContextMenu(event);
    this._appendBreakpointActiveItem(contextMenu);
    contextMenu.show();
  }

  /**
   * @param {!UI.ContextMenu} contextMenu
   */
  _appendBreakpointActiveItem(contextMenu) {
    var breakpointActive = this._breakpointManager.breakpointsActive();
    var breakpointActiveTitle = breakpointActive ? Common.UIString.capitalize('Deactivate ^breakpoints') :
                                                   Common.UIString.capitalize('Activate ^breakpoints');
    contextMenu.appendItem(
        breakpointActiveTitle,
        this._breakpointManager.setBreakpointsActive.bind(this._breakpointManager, !breakpointActive));
  }

  /**
   * @param {!Common.Event} event
   */
  _breakpointAdded(event) {
    this._breakpointRemoved(event);

    var breakpoint = /** @type {!Bindings.BreakpointManager.Breakpoint} */ (event.data.breakpoint);
    var uiLocation = /** @type {!Workspace.UILocation} */ (event.data.uiLocation);
    this._addBreakpoint(breakpoint, uiLocation);
  }

  /**
   * @param {!Bindings.BreakpointManager.Breakpoint} breakpoint
   * @param {!Workspace.UILocation} uiLocation
   */
  _addBreakpoint(breakpoint, uiLocation) {
    var element = createElementWithClass('li', 'cursor-pointer');
    element.addEventListener('contextmenu', this._breakpointContextMenu.bind(this, breakpoint), true);
    element.addEventListener('click', this._breakpointClicked.bind(this, uiLocation), false);

    var checkboxLabel = createCheckboxLabel(uiLocation.linkText(), breakpoint.enabled());
    element.appendChild(checkboxLabel);
    checkboxLabel.addEventListener('click', this._breakpointCheckboxClicked.bind(this, breakpoint), false);

    var snippetElement = element.createChild('div', 'source-text monospace');

    /**
     * @param {?string} content
     * @this {Sources.JavaScriptBreakpointsSidebarPane}
     */
    function didRequestContent(content) {
      var lineNumber = uiLocation.lineNumber;
      var columnNumber = uiLocation.columnNumber;
      var text = new Common.Text(content || '');
      if (lineNumber < text.lineCount()) {
        var lineText = text.lineAt(lineNumber);
        var maxSnippetLength = 200;
        var snippetStartIndex = columnNumber > 100 ? columnNumber : 0;
        snippetElement.textContent = lineText.substr(snippetStartIndex).trimEnd(maxSnippetLength);
      }
      this.didReceiveBreakpointLineForTest(uiLocation.uiSourceCode, lineNumber, columnNumber);
    }

    uiLocation.uiSourceCode.requestContent().then(didRequestContent.bind(this));

    element._data = uiLocation;
    var currentElement = this._listElement.firstChild;
    while (currentElement) {
      if (currentElement._data && this._compareBreakpoints(currentElement._data, element._data) > 0)
        break;
      currentElement = currentElement.nextSibling;
    }
    this._addListElement(element, currentElement);

    var breakpointItem = {element: element, checkbox: checkboxLabel.checkboxElement};
    this._items.set(breakpoint, breakpointItem);
  }

  /**
   * @param {!Workspace.UISourceCode} uiSourceCode
   * @param {number} lineNumber
   * @param {number} columnNumber
   */
  didReceiveBreakpointLineForTest(uiSourceCode, lineNumber, columnNumber) {
  }

  /**
   * @param {!Common.Event} event
   */
  _breakpointRemoved(event) {
    var breakpoint = /** @type {!Bindings.BreakpointManager.Breakpoint} */ (event.data.breakpoint);
    var breakpointItem = this._items.get(breakpoint);
    if (!breakpointItem)
      return;
    this._items.remove(breakpoint);
    this._removeListElement(breakpointItem.element);
  }

  /**
   * @override
   * @param {?Object} object
   */
  flavorChanged(object) {
    this._update();
  }

  _update() {
    var details = UI.context.flavor(SDK.DebuggerPausedDetails);
    var uiLocation = details && details.callFrames.length ?
        Bindings.debuggerWorkspaceBinding.rawLocationToUILocation(details.callFrames[0].location()) :
        null;
    var breakpoint = uiLocation ?
        this._breakpointManager.findBreakpoint(
            uiLocation.uiSourceCode, uiLocation.lineNumber, uiLocation.columnNumber) :
        null;
    var breakpointItem = this._items.get(breakpoint);
    if (!breakpointItem) {
      if (this._highlightedBreakpointItem) {
        this._highlightedBreakpointItem.element.classList.remove('breakpoint-hit');
        delete this._highlightedBreakpointItem;
      }
      return;
    }

    breakpointItem.element.classList.add('breakpoint-hit');
    this._highlightedBreakpointItem = breakpointItem;
    UI.viewManager.showView('sources.jsBreakpoints');
  }

  _breakpointsActiveStateChanged() {
    this._listElement.classList.toggle('breakpoints-list-deactivated', !this._breakpointManager.breakpointsActive());
  }

  /**
   * @param {!Workspace.UILocation} uiLocation
   */
  _breakpointClicked(uiLocation) {
    Common.Revealer.reveal(uiLocation);
  }

  /**
   * @param {!Bindings.BreakpointManager.Breakpoint} breakpoint
   * @param {!Event} event
   */
  _breakpointCheckboxClicked(breakpoint, event) {
    // Breakpoint element has it's own click handler.
    event.consume();
    breakpoint.setEnabled(event.target.checkboxElement.checked);
  }

  /**
   * @param {!Bindings.BreakpointManager.Breakpoint} breakpoint
   * @param {!Event} event
   */
  _breakpointContextMenu(breakpoint, event) {
    var breakpoints = this._items.valuesArray();
    var contextMenu = new UI.ContextMenu(event);
    contextMenu.appendItem(Common.UIString.capitalize('Remove ^breakpoint'), breakpoint.remove.bind(breakpoint));
    if (breakpoints.length > 1) {
      var removeAllTitle = Common.UIString.capitalize('Remove ^all ^breakpoints');
      contextMenu.appendItem(
          removeAllTitle, this._breakpointManager.removeAllBreakpoints.bind(this._breakpointManager));
    }

    contextMenu.appendSeparator();
    this._appendBreakpointActiveItem(contextMenu);

    function enabledBreakpointCount(breakpoints) {
      var count = 0;
      for (var i = 0; i < breakpoints.length; ++i) {
        if (breakpoints[i].checkbox.checked)
          count++;
      }
      return count;
    }
    if (breakpoints.length > 1) {
      var enableBreakpointCount = enabledBreakpointCount(breakpoints);
      var enableTitle = Common.UIString.capitalize('Enable ^all ^breakpoints');
      var disableTitle = Common.UIString.capitalize('Disable ^all ^breakpoints');

      contextMenu.appendSeparator();

      contextMenu.appendItem(
          enableTitle, this._breakpointManager.toggleAllBreakpoints.bind(this._breakpointManager, true),
          !(enableBreakpointCount !== breakpoints.length));
      contextMenu.appendItem(
          disableTitle, this._breakpointManager.toggleAllBreakpoints.bind(this._breakpointManager, false),
          !(enableBreakpointCount > 1));
    }

    contextMenu.show();
  }

  _addListElement(element, beforeElement) {
    if (beforeElement)
      this._listElement.insertBefore(element, beforeElement);
    else {
      if (!this._listElement.firstChild) {
        this.element.removeChild(this.emptyElement);
        this.element.appendChild(this._listElement);
      }
      this._listElement.appendChild(element);
    }
  }

  _removeListElement(element) {
    this._listElement.removeChild(element);
    if (!this._listElement.firstChild) {
      this.element.removeChild(this._listElement);
      this.element.appendChild(this.emptyElement);
    }
  }

  _compare(x, y) {
    if (x !== y)
      return x < y ? -1 : 1;
    return 0;
  }

  _compareBreakpoints(b1, b2) {
    return this._compare(b1.uiSourceCode.url(), b2.uiSourceCode.url()) || this._compare(b1.lineNumber, b2.lineNumber);
  }

  reset() {
    this._listElement.removeChildren();
    if (this._listElement.parentElement) {
      this.element.removeChild(this._listElement);
      this.element.appendChild(this.emptyElement);
    }
    this._items.clear();
  }
};
