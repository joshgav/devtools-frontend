// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
Components.FilmStripView = class extends UI.HBox {
  constructor() {
    super(true);
    this.registerRequiredCSS('components_lazy/filmStripView.css');
    this.contentElement.classList.add('film-strip-view');
    this._statusLabel = this.contentElement.createChild('div', 'label');
    this.reset();
    this.setMode(Components.FilmStripView.Modes.TimeBased);
  }

  /**
   * @param {!Element} imageElement
   * @param {?string} data
   */
  static _setImageData(imageElement, data) {
    if (data)
      imageElement.src = 'data:image/jpg;base64,' + data;
  }

  /**
   * @param {string} mode
   */
  setMode(mode) {
    this._mode = mode;
    this.contentElement.classList.toggle('time-based', mode === Components.FilmStripView.Modes.TimeBased);
    this.update();
  }

  /**
   * @param {!Components.FilmStripModel} filmStripModel
   * @param {number} zeroTime
   * @param {number} spanTime
   */
  setModel(filmStripModel, zeroTime, spanTime) {
    this._model = filmStripModel;
    this._zeroTime = zeroTime;
    this._spanTime = spanTime;
    var frames = filmStripModel.frames();
    if (!frames.length) {
      this.reset();
      return;
    }
    this.update();
  }

  /**
   * @param {!Components.FilmStripModel.Frame} frame
   * @return {!Promise<!Element>}
   */
  createFrameElement(frame) {
    var time = frame.timestamp;
    var element = createElementWithClass('div', 'frame');
    element.title = Common.UIString('Doubleclick to zoom image. Click to view preceding requests.');
    element.createChild('div', 'time').textContent = Number.millisToString(time - this._zeroTime);
    var imageElement = element.createChild('div', 'thumbnail').createChild('img');
    element.addEventListener(
        'mousedown', this._onMouseEvent.bind(this, Components.FilmStripView.Events.FrameSelected, time), false);
    element.addEventListener(
        'mouseenter', this._onMouseEvent.bind(this, Components.FilmStripView.Events.FrameEnter, time), false);
    element.addEventListener(
        'mouseout', this._onMouseEvent.bind(this, Components.FilmStripView.Events.FrameExit, time), false);
    element.addEventListener('dblclick', this._onDoubleClick.bind(this, frame), false);

    return frame.imageDataPromise()
        .then(Components.FilmStripView._setImageData.bind(null, imageElement))
        .then(returnElement);
    /**
     * @return {!Element}
     */
    function returnElement() {
      return element;
    }
  }

  /**
   * @param {number} time
   * @return {!Components.FilmStripModel.Frame}
   */
  frameByTime(time) {
    /**
     * @param {number} time
     * @param {!Components.FilmStripModel.Frame} frame
     * @return {number}
     */
    function comparator(time, frame) {
      return time - frame.timestamp;
    }
    // Using the first frame to fill the interval between recording start
    // and a moment the frame is taken.
    var frames = this._model.frames();
    var index = Math.max(frames.upperBound(time, comparator) - 1, 0);
    return frames[index];
  }

  update() {
    if (!this._model)
      return;
    var frames = this._model.frames();
    if (!frames.length)
      return;

    if (this._mode === Components.FilmStripView.Modes.FrameBased) {
      Promise.all(frames.map(this.createFrameElement.bind(this))).then(appendElements.bind(this));
      return;
    }

    var width = this.contentElement.clientWidth;
    var scale = this._spanTime / width;
    this.createFrameElement(frames[0]).then(
        continueWhenFrameImageLoaded.bind(this));  // Calculate frame width basing on the first frame.

    /**
     * @this {Components.FilmStripView}
     * @param {!Element} element0
     */
    function continueWhenFrameImageLoaded(element0) {
      var frameWidth = Math.ceil(UI.measurePreferredSize(element0, this.contentElement).width);
      if (!frameWidth)
        return;

      var promises = [];
      for (var pos = frameWidth; pos < width; pos += frameWidth) {
        var time = pos * scale + this._zeroTime;
        promises.push(this.createFrameElement(this.frameByTime(time)).then(fixWidth));
      }
      Promise.all(promises).then(appendElements.bind(this));
      /**
       * @param {!Element} element
       * @return {!Element}
       */
      function fixWidth(element) {
        element.style.width = frameWidth + 'px';
        return element;
      }
    }

    /**
     * @param {!Array.<!Element>} elements
     * @this {Components.FilmStripView}
     */
    function appendElements(elements) {
      this.contentElement.removeChildren();
      for (var i = 0; i < elements.length; ++i)
        this.contentElement.appendChild(elements[i]);
    }
  }

  /**
   * @override
   */
  onResize() {
    if (this._mode === Components.FilmStripView.Modes.FrameBased)
      return;
    this.update();
  }

  /**
   * @param {string} eventName
   * @param {number} timestamp
   */
  _onMouseEvent(eventName, timestamp) {
    this.dispatchEventToListeners(eventName, timestamp);
  }

  /**
   * @param {!Components.FilmStripModel.Frame} filmStripFrame
   */
  _onDoubleClick(filmStripFrame) {
    new Components.FilmStripView.Dialog(filmStripFrame, this._zeroTime);
  }

  reset() {
    this._zeroTime = 0;
    this.contentElement.removeChildren();
    this.contentElement.appendChild(this._statusLabel);
  }

  /**
   * @param {string} text
   */
  setStatusText(text) {
    this._statusLabel.textContent = text;
  }
};

/** @enum {symbol} */
Components.FilmStripView.Events = {
  FrameSelected: Symbol('FrameSelected'),
  FrameEnter: Symbol('FrameEnter'),
  FrameExit: Symbol('FrameExit'),
};

Components.FilmStripView.Modes = {
  TimeBased: 'TimeBased',
  FrameBased: 'FrameBased'
};


/**
 * @unrestricted
 */
Components.FilmStripView.Dialog = class extends UI.VBox {
  /**
   * @param {!Components.FilmStripModel.Frame} filmStripFrame
   * @param {number=} zeroTime
   */
  constructor(filmStripFrame, zeroTime) {
    super(true);
    this.registerRequiredCSS('components_lazy/filmStripDialog.css');
    this.contentElement.classList.add('filmstrip-dialog');
    this.contentElement.tabIndex = 0;

    this._frames = filmStripFrame.model().frames();
    this._index = filmStripFrame.index;
    this._zeroTime = zeroTime || filmStripFrame.model().zeroTime();

    this._imageElement = this.contentElement.createChild('img');
    var footerElement = this.contentElement.createChild('div', 'filmstrip-dialog-footer');
    footerElement.createChild('div', 'flex-auto');
    var prevButton =
        createTextButton('\u25C0', this._onPrevFrame.bind(this), undefined, Common.UIString('Previous frame'));
    footerElement.appendChild(prevButton);
    this._timeLabel = footerElement.createChild('div', 'filmstrip-dialog-label');
    var nextButton =
        createTextButton('\u25B6', this._onNextFrame.bind(this), undefined, Common.UIString('Next frame'));
    footerElement.appendChild(nextButton);
    footerElement.createChild('div', 'flex-auto');

    this.contentElement.addEventListener('keydown', this._keyDown.bind(this), false);
    this.setDefaultFocusedElement(this.contentElement);
    this._render();
  }

  _resize() {
    if (!this._dialog) {
      this._dialog = new UI.Dialog();
      this.show(this._dialog.element);
      this._dialog.setWrapsContent(true);
      this._dialog.show();
    }
    this._dialog.contentResized();
  }

  /**
   * @param {!Event} event
   */
  _keyDown(event) {
    switch (event.key) {
      case 'ArrowLeft':
        if (Host.isMac() && event.metaKey)
          this._onFirstFrame();
        else
          this._onPrevFrame();
        break;

      case 'ArrowRight':
        if (Host.isMac() && event.metaKey)
          this._onLastFrame();
        else
          this._onNextFrame();
        break;

      case 'Home':
        this._onFirstFrame();
        break;

      case 'End':
        this._onLastFrame();
        break;
    }
  }

  _onPrevFrame() {
    if (this._index > 0)
      --this._index;
    this._render();
  }

  _onNextFrame() {
    if (this._index < this._frames.length - 1)
      ++this._index;
    this._render();
  }

  _onFirstFrame() {
    this._index = 0;
    this._render();
  }

  _onLastFrame() {
    this._index = this._frames.length - 1;
    this._render();
  }

  /**
   * @return {!Promise<undefined>}
   */
  _render() {
    var frame = this._frames[this._index];
    this._timeLabel.textContent = Number.millisToString(frame.timestamp - this._zeroTime);
    return frame.imageDataPromise()
        .then(Components.FilmStripView._setImageData.bind(null, this._imageElement))
        .then(this._resize.bind(this));
  }
};
