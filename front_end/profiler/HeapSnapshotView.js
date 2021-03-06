/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/**
 * @implements {Profiler.ProfileType.DataDisplayDelegate}
 * @implements {UI.Searchable}
 * @unrestricted
 */
Profiler.HeapSnapshotView = class extends UI.SimpleView {
  /**
   * @param {!Profiler.ProfileType.DataDisplayDelegate} dataDisplayDelegate
   * @param {!Profiler.HeapProfileHeader} profile
   */
  constructor(dataDisplayDelegate, profile) {
    super(Common.UIString('Heap Snapshot'));

    this.element.classList.add('heap-snapshot-view');

    profile.profileType().addEventListener(
        Profiler.HeapSnapshotProfileType.SnapshotReceived, this._onReceiveSnapshot, this);
    profile.profileType().addEventListener(
        Profiler.ProfileType.Events.RemoveProfileHeader, this._onProfileHeaderRemoved, this);

    var isHeapTimeline = profile.profileType().id === Profiler.TrackingHeapSnapshotProfileType.TypeId;
    if (isHeapTimeline) {
      this._trackingOverviewGrid = new Profiler.HeapTrackingOverviewGrid(profile);
      this._trackingOverviewGrid.addEventListener(
          Profiler.HeapTrackingOverviewGrid.IdsRangeChanged, this._onIdsRangeChanged.bind(this));
    }

    this._parentDataDisplayDelegate = dataDisplayDelegate;

    this._searchableView = new UI.SearchableView(this);
    this._searchableView.show(this.element);

    this._splitWidget = new UI.SplitWidget(false, true, 'heapSnapshotSplitViewState', 200, 200);
    this._splitWidget.show(this._searchableView.element);

    this._containmentDataGrid = new Profiler.HeapSnapshotContainmentDataGrid(this);
    this._containmentDataGrid.addEventListener(UI.DataGrid.Events.SelectedNode, this._selectionChanged, this);
    this._containmentWidget = this._containmentDataGrid.asWidget();
    this._containmentWidget.setMinimumSize(50, 25);

    this._statisticsView = new Profiler.HeapSnapshotStatisticsView();

    this._constructorsDataGrid = new Profiler.HeapSnapshotConstructorsDataGrid(this);
    this._constructorsDataGrid.addEventListener(
        UI.DataGrid.Events.SelectedNode, this._selectionChanged, this);
    this._constructorsWidget = this._constructorsDataGrid.asWidget();
    this._constructorsWidget.setMinimumSize(50, 25);

    this._diffDataGrid = new Profiler.HeapSnapshotDiffDataGrid(this);
    this._diffDataGrid.addEventListener(UI.DataGrid.Events.SelectedNode, this._selectionChanged, this);
    this._diffWidget = this._diffDataGrid.asWidget();
    this._diffWidget.setMinimumSize(50, 25);

    if (isHeapTimeline && Common.moduleSetting('recordAllocationStacks').get()) {
      this._allocationDataGrid = new Profiler.AllocationDataGrid(profile.target(), this);
      this._allocationDataGrid.addEventListener(
          UI.DataGrid.Events.SelectedNode, this._onSelectAllocationNode, this);
      this._allocationWidget = this._allocationDataGrid.asWidget();
      this._allocationWidget.setMinimumSize(50, 25);

      this._allocationStackView = new Profiler.HeapAllocationStackView(profile.target());
      this._allocationStackView.setMinimumSize(50, 25);

      this._tabbedPane = new UI.TabbedPane();
    }

    this._retainmentDataGrid = new Profiler.HeapSnapshotRetainmentDataGrid(this);
    this._retainmentWidget = this._retainmentDataGrid.asWidget();
    this._retainmentWidget.setMinimumSize(50, 21);
    this._retainmentWidget.element.classList.add('retaining-paths-view');

    var splitWidgetResizer;
    if (this._allocationStackView) {
      this._tabbedPane = new UI.TabbedPane();

      this._tabbedPane.appendTab('retainers', Common.UIString('Retainers'), this._retainmentWidget);
      this._tabbedPane.appendTab(
          'allocation-stack', Common.UIString('Allocation stack'), this._allocationStackView);

      splitWidgetResizer = this._tabbedPane.headerElement();
      this._objectDetailsView = this._tabbedPane;
    } else {
      var retainmentViewHeader = createElementWithClass('div', 'heap-snapshot-view-resizer');
      var retainingPathsTitleDiv = retainmentViewHeader.createChild('div', 'title');
      var retainingPathsTitle = retainingPathsTitleDiv.createChild('span');
      retainingPathsTitle.textContent = Common.UIString('Retainers');

      splitWidgetResizer = retainmentViewHeader;
      this._objectDetailsView = new UI.VBox();
      this._objectDetailsView.element.appendChild(retainmentViewHeader);
      this._retainmentWidget.show(this._objectDetailsView.element);
    }
    this._splitWidget.hideDefaultResizer();
    this._splitWidget.installResizer(splitWidgetResizer);

    this._retainmentDataGrid.addEventListener(
        UI.DataGrid.Events.SelectedNode, this._inspectedObjectChanged, this);
    this._retainmentDataGrid.reset();

    this._perspectives = [];
    this._perspectives.push(new Profiler.HeapSnapshotView.SummaryPerspective());
    if (profile.profileType() !== Profiler.ProfileTypeRegistry.instance.trackingHeapSnapshotProfileType)
      this._perspectives.push(new Profiler.HeapSnapshotView.ComparisonPerspective());
    this._perspectives.push(new Profiler.HeapSnapshotView.ContainmentPerspective());
    if (this._allocationWidget)
      this._perspectives.push(new Profiler.HeapSnapshotView.AllocationPerspective());
    this._perspectives.push(new Profiler.HeapSnapshotView.StatisticsPerspective());

    this._perspectiveSelect = new UI.ToolbarComboBox(this._onSelectedPerspectiveChanged.bind(this));
    for (var i = 0; i < this._perspectives.length; ++i)
      this._perspectiveSelect.createOption(this._perspectives[i].title());

    this._profile = profile;

    this._baseSelect = new UI.ToolbarComboBox(this._changeBase.bind(this));
    this._baseSelect.setVisible(false);
    this._updateBaseOptions();

    this._filterSelect = new UI.ToolbarComboBox(this._changeFilter.bind(this));
    this._filterSelect.setVisible(false);
    this._updateFilterOptions();

    this._classNameFilter = new UI.ToolbarInput('Class filter');
    this._classNameFilter.setVisible(false);
    this._constructorsDataGrid.setNameFilter(this._classNameFilter);
    this._diffDataGrid.setNameFilter(this._classNameFilter);

    this._selectedSizeText = new UI.ToolbarText();

    this._popoverHelper = new Components.ObjectPopoverHelper(
        this.element, this._getHoverAnchor.bind(this), this._resolveObjectForPopover.bind(this), undefined, true);

    this._currentPerspectiveIndex = 0;
    this._currentPerspective = this._perspectives[0];
    this._currentPerspective.activate(this);
    this._dataGrid = this._currentPerspective.masterGrid(this);

    this._populate();
    this._searchThrottler = new Common.Throttler(0);
  }

  /**
   * @return {!UI.SearchableView}
   */
  searchableView() {
    return this._searchableView;
  }

  /**
   * @override
   * @param {?Profiler.ProfileHeader} profile
   * @return {?UI.Widget}
   */
  showProfile(profile) {
    return this._parentDataDisplayDelegate.showProfile(profile);
  }

  /**
   * @override
   * @param {!Protocol.HeapProfiler.HeapSnapshotObjectId} snapshotObjectId
   * @param {string} perspectiveName
   */
  showObject(snapshotObjectId, perspectiveName) {
    if (snapshotObjectId <= this._profile.maxJSObjectId)
      this.selectLiveObject(perspectiveName, snapshotObjectId);
    else
      this._parentDataDisplayDelegate.showObject(snapshotObjectId, perspectiveName);
  }

  _populate() {
    this._profile._loadPromise
        .then(heapSnapshotProxy => {
          heapSnapshotProxy.getStatistics().then(this._gotStatistics.bind(this));
          this._dataGrid.setDataSource(heapSnapshotProxy);
          if (this._profile.profileType().id === Profiler.TrackingHeapSnapshotProfileType.TypeId &&
              this._profile.fromFile())
            return heapSnapshotProxy.getSamples().then(samples => this._trackingOverviewGrid._setSamples(samples));
        })
        .then(_ => {
          var list = this._profiles();
          var profileIndex = list.indexOf(this._profile);
          this._baseSelect.setSelectedIndex(Math.max(0, profileIndex - 1));
          if (this._trackingOverviewGrid)
            this._trackingOverviewGrid._updateGrid();
        });
  }

  /**
   * @param {!Profiler.HeapSnapshotCommon.Statistics} statistics
   */
  _gotStatistics(statistics) {
    this._statisticsView.setTotal(statistics.total);
    this._statisticsView.addRecord(statistics.code, Common.UIString('Code'), '#f77');
    this._statisticsView.addRecord(statistics.strings, Common.UIString('Strings'), '#5e5');
    this._statisticsView.addRecord(statistics.jsArrays, Common.UIString('JS Arrays'), '#7af');
    this._statisticsView.addRecord(statistics.native, Common.UIString('Typed Arrays'), '#fc5');
    this._statisticsView.addRecord(statistics.system, Common.UIString('System Objects'), '#98f');
    this._statisticsView.addRecord(statistics.total, Common.UIString('Total'));
  }

  /**
   * @param {!Common.Event} event
   */
  _onIdsRangeChanged(event) {
    var minId = event.data.minId;
    var maxId = event.data.maxId;
    this._selectedSizeText.setText(Common.UIString('Selected size: %s', Number.bytesToString(event.data.size)));
    if (this._constructorsDataGrid.snapshot)
      this._constructorsDataGrid.setSelectionRange(minId, maxId);
  }

  /**
   * @override
   * @return {!Array.<!UI.ToolbarItem>}
   */
  syncToolbarItems() {
    var result = [this._perspectiveSelect, this._classNameFilter];
    if (this._profile.profileType() !== Profiler.ProfileTypeRegistry.instance.trackingHeapSnapshotProfileType)
      result.push(this._baseSelect, this._filterSelect);
    result.push(this._selectedSizeText);
    return result;
  }

  /**
   * @override
   */
  wasShown() {
    this._profile._loadPromise.then(this._profile._wasShown.bind(this._profile));
  }

  /**
   * @override
   */
  willHide() {
    this._currentSearchResultIndex = -1;
    this._popoverHelper.hidePopover();
    if (this.helpPopover && this.helpPopover.isShowing())
      this.helpPopover.hide();
  }

  /**
   * @override
   * @return {boolean}
   */
  supportsCaseSensitiveSearch() {
    return true;
  }

  /**
   * @override
   * @return {boolean}
   */
  supportsRegexSearch() {
    return false;
  }

  /**
   * @override
   */
  searchCanceled() {
    this._currentSearchResultIndex = -1;
    this._searchResults = [];
  }

  /**
   * @param {?Profiler.HeapSnapshotGridNode} node
   */
  _selectRevealedNode(node) {
    if (node)
      node.select();
  }

  /**
   * @override
   * @param {!UI.SearchableView.SearchConfig} searchConfig
   * @param {boolean} shouldJump
   * @param {boolean=} jumpBackwards
   */
  performSearch(searchConfig, shouldJump, jumpBackwards) {
    var nextQuery = new Profiler.HeapSnapshotCommon.SearchConfig(
        searchConfig.query.trim(), searchConfig.caseSensitive, searchConfig.isRegex, shouldJump,
        jumpBackwards || false);

    this._searchThrottler.schedule(this._performSearch.bind(this, nextQuery));
  }

  /**
   * @param {!Profiler.HeapSnapshotCommon.SearchConfig} nextQuery
   * @return {!Promise<?>}
   */
  _performSearch(nextQuery) {
    // Call searchCanceled since it will reset everything we need before doing a new search.
    this.searchCanceled();

    if (!this._currentPerspective.supportsSearch())
      return Promise.resolve();

    this.currentQuery = nextQuery;
    var query = nextQuery.query.trim();

    if (!query)
      return Promise.resolve();

    if (query.charAt(0) === '@') {
      var snapshotNodeId = parseInt(query.substring(1), 10);
      if (isNaN(snapshotNodeId))
        return Promise.resolve();
      return this._dataGrid.revealObjectByHeapSnapshotId(String(snapshotNodeId))
          .then(this._selectRevealedNode.bind(this));
    }

    /**
     * @param {!Array<number>} entryIds
     * @return {!Promise<?>}
     * @this {Profiler.HeapSnapshotView}
     */
    function didSearch(entryIds) {
      this._searchResults = entryIds;
      this._searchableView.updateSearchMatchesCount(this._searchResults.length);
      if (this._searchResults.length)
        this._currentSearchResultIndex = nextQuery.jumpBackwards ? this._searchResults.length - 1 : 0;
      return this._jumpToSearchResult(this._currentSearchResultIndex);
    }

    return this._profile._snapshotProxy.search(this.currentQuery, this._dataGrid.nodeFilter())
        .then(didSearch.bind(this));
  }

  /**
   * @override
   */
  jumpToNextSearchResult() {
    if (!this._searchResults.length)
      return;
    this._currentSearchResultIndex = (this._currentSearchResultIndex + 1) % this._searchResults.length;
    this._searchThrottler.schedule(this._jumpToSearchResult.bind(this, this._currentSearchResultIndex));
  }

  /**
   * @override
   */
  jumpToPreviousSearchResult() {
    if (!this._searchResults.length)
      return;
    this._currentSearchResultIndex =
        (this._currentSearchResultIndex + this._searchResults.length - 1) % this._searchResults.length;
    this._searchThrottler.schedule(this._jumpToSearchResult.bind(this, this._currentSearchResultIndex));
  }

  /**
   * @param {number} searchResultIndex
   * @return {!Promise<undefined>}
   */
  _jumpToSearchResult(searchResultIndex) {
    this._searchableView.updateCurrentMatchIndex(searchResultIndex);
    return this._dataGrid.revealObjectByHeapSnapshotId(String(this._searchResults[searchResultIndex]))
        .then(this._selectRevealedNode.bind(this));
  }

  refreshVisibleData() {
    if (!this._dataGrid)
      return;
    var child = this._dataGrid.rootNode().children[0];
    while (child) {
      child.refresh();
      child = child.traverseNextNode(false, null, true);
    }
  }

  _changeBase() {
    if (this._baseProfile === this._profiles()[this._baseSelect.selectedIndex()])
      return;

    this._baseProfile = this._profiles()[this._baseSelect.selectedIndex()];
    var dataGrid = /** @type {!Profiler.HeapSnapshotDiffDataGrid} */ (this._dataGrid);
    // Change set base data source only if main data source is already set.
    if (dataGrid.snapshot)
      this._baseProfile._loadPromise.then(dataGrid.setBaseDataSource.bind(dataGrid));

    if (!this.currentQuery || !this._searchResults)
      return;

    // The current search needs to be performed again. First negate out previous match
    // count by calling the search finished callback with a negative number of matches.
    // Then perform the search again with the same query and callback.
    this.performSearch(this.currentQuery, false);
  }

  _changeFilter() {
    var profileIndex = this._filterSelect.selectedIndex() - 1;
    this._dataGrid.filterSelectIndexChanged(this._profiles(), profileIndex);

    if (!this.currentQuery || !this._searchResults)
      return;

    // The current search needs to be performed again. First negate out previous match
    // count by calling the search finished callback with a negative number of matches.
    // Then perform the search again with the same query and callback.
    this.performSearch(this.currentQuery, false);
  }

  /**
   * @return {!Array.<!Profiler.ProfileHeader>}
   */
  _profiles() {
    return this._profile.profileType().getProfiles();
  }

  /**
   * @param {!UI.ContextMenu} contextMenu
   * @param {!Event} event
   */
  populateContextMenu(contextMenu, event) {
    if (this._dataGrid)
      this._dataGrid.populateContextMenu(contextMenu, event);
  }

  _selectionChanged(event) {
    var selectedNode = event.target.selectedNode;
    this._setSelectedNodeForDetailsView(selectedNode);
    this._inspectedObjectChanged(event);
  }

  _onSelectAllocationNode(event) {
    var selectedNode = event.target.selectedNode;
    this._constructorsDataGrid.setAllocationNodeId(selectedNode.allocationNodeId());
    this._setSelectedNodeForDetailsView(null);
  }

  _inspectedObjectChanged(event) {
    var selectedNode = event.target.selectedNode;
    var target = this._profile.target();
    if (target && selectedNode instanceof Profiler.HeapSnapshotGenericObjectNode)
      target.heapProfilerAgent().addInspectedHeapObject(String(selectedNode.snapshotNodeId));
  }

  /**
   * @param {?Profiler.HeapSnapshotGridNode} nodeItem
   */
  _setSelectedNodeForDetailsView(nodeItem) {
    var dataSource = nodeItem && nodeItem.retainersDataSource();
    if (dataSource) {
      this._retainmentDataGrid.setDataSource(dataSource.snapshot, dataSource.snapshotNodeIndex);
      if (this._allocationStackView)
        this._allocationStackView.setAllocatedObject(dataSource.snapshot, dataSource.snapshotNodeIndex);
    } else {
      if (this._allocationStackView)
        this._allocationStackView.clear();
      this._retainmentDataGrid.reset();
    }
  }

  /**
   * @param {string} perspectiveTitle
   * @param {function()} callback
   */
  _changePerspectiveAndWait(perspectiveTitle, callback) {
    var perspectiveIndex = null;
    for (var i = 0; i < this._perspectives.length; ++i) {
      if (this._perspectives[i].title() === perspectiveTitle) {
        perspectiveIndex = i;
        break;
      }
    }
    if (this._currentPerspectiveIndex === perspectiveIndex || perspectiveIndex === null) {
      setTimeout(callback, 0);
      return;
    }

    /**
     * @this {Profiler.HeapSnapshotView}
     */
    function dataGridContentShown(event) {
      var dataGrid = event.data;
      dataGrid.removeEventListener(
          Profiler.HeapSnapshotSortableDataGrid.Events.ContentShown, dataGridContentShown, this);
      if (dataGrid === this._dataGrid)
        callback();
    }
    this._perspectives[perspectiveIndex].masterGrid(this).addEventListener(
        Profiler.HeapSnapshotSortableDataGrid.Events.ContentShown, dataGridContentShown, this);

    this._perspectiveSelect.setSelectedIndex(perspectiveIndex);
    this._changePerspective(perspectiveIndex);
  }

  _updateDataSourceAndView() {
    var dataGrid = this._dataGrid;
    if (!dataGrid || dataGrid.snapshot)
      return;

    this._profile._loadPromise.then(didLoadSnapshot.bind(this));

    /**
     * @this {Profiler.HeapSnapshotView}
     */
    function didLoadSnapshot(snapshotProxy) {
      if (this._dataGrid !== dataGrid)
        return;
      if (dataGrid.snapshot !== snapshotProxy)
        dataGrid.setDataSource(snapshotProxy);
      if (dataGrid === this._diffDataGrid) {
        if (!this._baseProfile)
          this._baseProfile = this._profiles()[this._baseSelect.selectedIndex()];
        this._baseProfile._loadPromise.then(didLoadBaseSnapshot.bind(this));
      }
    }

    /**
     * @this {Profiler.HeapSnapshotView}
     */
    function didLoadBaseSnapshot(baseSnapshotProxy) {
      if (this._diffDataGrid.baseSnapshot !== baseSnapshotProxy)
        this._diffDataGrid.setBaseDataSource(baseSnapshotProxy);
    }
  }

  _onSelectedPerspectiveChanged(event) {
    this._changePerspective(event.target.selectedIndex);
  }

  /**
   * @param {number} selectedIndex
   */
  _changePerspective(selectedIndex) {
    if (selectedIndex === this._currentPerspectiveIndex)
      return;

    this._currentPerspectiveIndex = selectedIndex;

    this._currentPerspective.deactivate(this);
    var perspective = this._perspectives[selectedIndex];
    this._currentPerspective = perspective;
    this._dataGrid = perspective.masterGrid(this);
    perspective.activate(this);

    this.refreshVisibleData();
    if (this._dataGrid)
      this._dataGrid.updateWidths();

    this._updateDataSourceAndView();

    if (!this.currentQuery || !this._searchResults)
      return;

    // The current search needs to be performed again. First negate out previous match
    // count by calling the search finished callback with a negative number of matches.
    // Then perform the search again the with same query and callback.
    this.performSearch(this.currentQuery, false);
  }

  /**
   * @param {string} perspectiveName
   * @param {!Protocol.HeapProfiler.HeapSnapshotObjectId} snapshotObjectId
   */
  selectLiveObject(perspectiveName, snapshotObjectId) {
    this._changePerspectiveAndWait(perspectiveName, didChangePerspective.bind(this));

    /**
     * @this {Profiler.HeapSnapshotView}
     */
    function didChangePerspective() {
      this._dataGrid.revealObjectByHeapSnapshotId(snapshotObjectId, didRevealObject);
    }

    /**
     * @param {?Profiler.HeapSnapshotGridNode} node
     */
    function didRevealObject(node) {
      if (node)
        node.select();
      else
        Common.console.error('Cannot find corresponding heap snapshot node');
    }
  }

  _getHoverAnchor(target) {
    var span = target.enclosingNodeOrSelfWithNodeName('span');
    if (!span)
      return;
    var row = target.enclosingNodeOrSelfWithNodeName('tr');
    if (!row)
      return;
    span.node = row._dataGridNode;
    return span;
  }

  _resolveObjectForPopover(element, showCallback, objectGroupName) {
    if (!this._profile.target())
      return;
    if (!element.node)
      return;
    element.node.queryObjectContent(this._profile.target(), showCallback, objectGroupName);
  }

  _updateBaseOptions() {
    var list = this._profiles();
    // We're assuming that snapshots can only be added.
    if (this._baseSelect.size() === list.length)
      return;

    for (var i = this._baseSelect.size(), n = list.length; i < n; ++i) {
      var title = list[i].title;
      this._baseSelect.createOption(title);
    }
  }

  _updateFilterOptions() {
    var list = this._profiles();
    // We're assuming that snapshots can only be added.
    if (this._filterSelect.size() - 1 === list.length)
      return;

    if (!this._filterSelect.size())
      this._filterSelect.createOption(Common.UIString('All objects'));

    for (var i = this._filterSelect.size() - 1, n = list.length; i < n; ++i) {
      var title = list[i].title;
      if (!i)
        title = Common.UIString('Objects allocated before %s', title);
      else
        title = Common.UIString('Objects allocated between %s and %s', list[i - 1].title, title);
      this._filterSelect.createOption(title);
    }
  }

  _updateControls() {
    this._updateBaseOptions();
    this._updateFilterOptions();
  }

  /**
   * @param {!Common.Event} event
   */
  _onReceiveSnapshot(event) {
    this._updateControls();
  }

  /**
   * @param {!Common.Event} event
   */
  _onProfileHeaderRemoved(event) {
    var profile = event.data;
    if (this._profile === profile) {
      this.detach();
      this._profile.profileType().removeEventListener(
          Profiler.HeapSnapshotProfileType.SnapshotReceived, this._onReceiveSnapshot, this);
      this._profile.profileType().removeEventListener(
          Profiler.ProfileType.Events.RemoveProfileHeader, this._onProfileHeaderRemoved, this);
      this.dispose();
    } else {
      this._updateControls();
    }
  }

  dispose() {
    if (this._allocationStackView) {
      this._allocationStackView.clear();
      this._allocationDataGrid.dispose();
    }
    if (this._trackingOverviewGrid)
      this._trackingOverviewGrid.dispose();
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotView.Perspective = class {
  /**
   * @param {string} title
   */
  constructor(title) {
    this._title = title;
  }

  /**
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  activate(heapSnapshotView) {
  }

  /**
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  deactivate(heapSnapshotView) {
    heapSnapshotView._baseSelect.setVisible(false);
    heapSnapshotView._filterSelect.setVisible(false);
    heapSnapshotView._classNameFilter.setVisible(false);
    if (heapSnapshotView._trackingOverviewGrid)
      heapSnapshotView._trackingOverviewGrid.detach();
    if (heapSnapshotView._allocationWidget)
      heapSnapshotView._allocationWidget.detach();
    if (heapSnapshotView._statisticsView)
      heapSnapshotView._statisticsView.detach();

    heapSnapshotView._splitWidget.detach();
    heapSnapshotView._splitWidget.detachChildWidgets();
  }

  /**
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   * @return {?UI.DataGrid}
   */
  masterGrid(heapSnapshotView) {
    return null;
  }

  /**
   * @return {string}
   */
  title() {
    return this._title;
  }

  /**
   * @return {boolean}
   */
  supportsSearch() {
    return false;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotView.SummaryPerspective = class extends Profiler.HeapSnapshotView.Perspective {
  constructor() {
    super(Common.UIString('Summary'));
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  activate(heapSnapshotView) {
    heapSnapshotView._splitWidget.setMainWidget(heapSnapshotView._constructorsWidget);
    heapSnapshotView._splitWidget.setSidebarWidget(heapSnapshotView._objectDetailsView);
    heapSnapshotView._splitWidget.show(heapSnapshotView._searchableView.element);
    heapSnapshotView._filterSelect.setVisible(true);
    heapSnapshotView._classNameFilter.setVisible(true);
    if (heapSnapshotView._trackingOverviewGrid) {
      heapSnapshotView._trackingOverviewGrid.show(
          heapSnapshotView._searchableView.element, heapSnapshotView._splitWidget.element);
      heapSnapshotView._trackingOverviewGrid.update();
      heapSnapshotView._trackingOverviewGrid._updateGrid();
    }
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   * @return {?UI.DataGrid}
   */
  masterGrid(heapSnapshotView) {
    return heapSnapshotView._constructorsDataGrid;
  }

  /**
   * @override
   * @return {boolean}
   */
  supportsSearch() {
    return true;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotView.ComparisonPerspective = class extends Profiler.HeapSnapshotView.Perspective {
  constructor() {
    super(Common.UIString('Comparison'));
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  activate(heapSnapshotView) {
    heapSnapshotView._splitWidget.setMainWidget(heapSnapshotView._diffWidget);
    heapSnapshotView._splitWidget.setSidebarWidget(heapSnapshotView._objectDetailsView);
    heapSnapshotView._splitWidget.show(heapSnapshotView._searchableView.element);
    heapSnapshotView._baseSelect.setVisible(true);
    heapSnapshotView._classNameFilter.setVisible(true);
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   * @return {?UI.DataGrid}
   */
  masterGrid(heapSnapshotView) {
    return heapSnapshotView._diffDataGrid;
  }

  /**
   * @override
   * @return {boolean}
   */
  supportsSearch() {
    return true;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotView.ContainmentPerspective = class extends Profiler.HeapSnapshotView.Perspective {
  constructor() {
    super(Common.UIString('Containment'));
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  activate(heapSnapshotView) {
    heapSnapshotView._splitWidget.setMainWidget(heapSnapshotView._containmentWidget);
    heapSnapshotView._splitWidget.setSidebarWidget(heapSnapshotView._objectDetailsView);
    heapSnapshotView._splitWidget.show(heapSnapshotView._searchableView.element);
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   * @return {?UI.DataGrid}
   */
  masterGrid(heapSnapshotView) {
    return heapSnapshotView._containmentDataGrid;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotView.AllocationPerspective = class extends Profiler.HeapSnapshotView.Perspective {
  constructor() {
    super(Common.UIString('Allocation'));
    this._allocationSplitWidget =
        new UI.SplitWidget(false, true, 'heapSnapshotAllocationSplitViewState', 200, 200);
    this._allocationSplitWidget.setSidebarWidget(new UI.VBox());
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  activate(heapSnapshotView) {
    this._allocationSplitWidget.setMainWidget(heapSnapshotView._allocationWidget);
    heapSnapshotView._splitWidget.setMainWidget(heapSnapshotView._constructorsWidget);
    heapSnapshotView._splitWidget.setSidebarWidget(heapSnapshotView._objectDetailsView);

    var allocatedObjectsView = new UI.VBox();
    var resizer = createElementWithClass('div', 'heap-snapshot-view-resizer');
    var title = resizer.createChild('div', 'title').createChild('span');
    title.textContent = Common.UIString('Live objects');
    this._allocationSplitWidget.hideDefaultResizer();
    this._allocationSplitWidget.installResizer(resizer);
    allocatedObjectsView.element.appendChild(resizer);
    heapSnapshotView._splitWidget.show(allocatedObjectsView.element);
    this._allocationSplitWidget.setSidebarWidget(allocatedObjectsView);

    this._allocationSplitWidget.show(heapSnapshotView._searchableView.element);

    heapSnapshotView._constructorsDataGrid.clear();
    var selectedNode = heapSnapshotView._allocationDataGrid.selectedNode;
    if (selectedNode)
      heapSnapshotView._constructorsDataGrid.setAllocationNodeId(selectedNode.allocationNodeId());
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  deactivate(heapSnapshotView) {
    this._allocationSplitWidget.detach();
    super.deactivate(heapSnapshotView);
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   * @return {?UI.DataGrid}
   */
  masterGrid(heapSnapshotView) {
    return heapSnapshotView._allocationDataGrid;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotView.StatisticsPerspective = class extends Profiler.HeapSnapshotView.Perspective {
  constructor() {
    super(Common.UIString('Statistics'));
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   */
  activate(heapSnapshotView) {
    heapSnapshotView._statisticsView.show(heapSnapshotView._searchableView.element);
  }

  /**
   * @override
   * @param {!Profiler.HeapSnapshotView} heapSnapshotView
   * @return {?UI.DataGrid}
   */
  masterGrid(heapSnapshotView) {
    return null;
  }
};

/**
 * @implements {SDK.TargetManager.Observer}
 * @unrestricted
 */
Profiler.HeapSnapshotProfileType = class extends Profiler.ProfileType {
  /**
   * @param {string=} id
   * @param {string=} title
   */
  constructor(id, title) {
    super(id || Profiler.HeapSnapshotProfileType.TypeId, title || Common.UIString('Take Heap Snapshot'));
    SDK.targetManager.observeTargets(this);
    SDK.targetManager.addModelListener(
        SDK.HeapProfilerModel, SDK.HeapProfilerModel.Events.ResetProfiles, this._resetProfiles, this);
    SDK.targetManager.addModelListener(
        SDK.HeapProfilerModel, SDK.HeapProfilerModel.Events.AddHeapSnapshotChunk,
        this._addHeapSnapshotChunk, this);
    SDK.targetManager.addModelListener(
        SDK.HeapProfilerModel, SDK.HeapProfilerModel.Events.ReportHeapSnapshotProgress,
        this._reportHeapSnapshotProgress, this);
  }

  /**
   * @override
   * @param {!SDK.Target} target
   */
  targetAdded(target) {
    target.heapProfilerModel.enable();
  }

  /**
   * @override
   * @param {!SDK.Target} target
   */
  targetRemoved(target) {
  }

  /**
   * @override
   * @return {string}
   */
  fileExtension() {
    return '.heapsnapshot';
  }

  get buttonTooltip() {
    return Common.UIString('Take heap snapshot');
  }

  /**
   * @override
   * @return {boolean}
   */
  isInstantProfile() {
    return true;
  }

  /**
   * @override
   * @return {boolean}
   */
  buttonClicked() {
    this._takeHeapSnapshot(function() {});
    Host.userMetrics.actionTaken(Host.UserMetrics.Action.ProfilesHeapProfileTaken);
    return false;
  }

  get treeItemTitle() {
    return Common.UIString('HEAP SNAPSHOTS');
  }

  get description() {
    return Common.UIString(
        'Heap snapshot profiles show memory distribution among your page\'s JavaScript objects and related DOM nodes.');
  }

  /**
   * @override
   * @param {string} title
   * @return {!Profiler.ProfileHeader}
   */
  createProfileLoadedFromFile(title) {
    return new Profiler.HeapProfileHeader(null, this, title);
  }

  _takeHeapSnapshot(callback) {
    if (this.profileBeingRecorded())
      return;
    var target = /** @type {!SDK.Target} */ (UI.context.flavor(SDK.Target));
    var profile = new Profiler.HeapProfileHeader(target, this);
    this.setProfileBeingRecorded(profile);
    this.addProfile(profile);
    profile.updateStatus(Common.UIString('Snapshotting\u2026'));

    /**
     * @param {?string} error
     * @this {Profiler.HeapSnapshotProfileType}
     */
    function didTakeHeapSnapshot(error) {
      var profile = this._profileBeingRecorded;
      profile.title = Common.UIString('Snapshot %d', profile.uid);
      profile._finishLoad();
      this.setProfileBeingRecorded(null);
      this.dispatchEventToListeners(Profiler.ProfileType.Events.ProfileComplete, profile);
      callback();
    }
    target.heapProfilerAgent().takeHeapSnapshot(true, didTakeHeapSnapshot.bind(this));
  }

  /**
   * @param {!Common.Event} event
   */
  _addHeapSnapshotChunk(event) {
    if (!this.profileBeingRecorded())
      return;
    var chunk = /** @type {string} */ (event.data);
    this.profileBeingRecorded().transferChunk(chunk);
  }

  /**
   * @param {!Common.Event} event
   */
  _reportHeapSnapshotProgress(event) {
    var profile = this.profileBeingRecorded();
    if (!profile)
      return;
    var data = /** @type {{done: number, total: number, finished: boolean}} */ (event.data);
    profile.updateStatus(Common.UIString('%.0f%%', (data.done / data.total) * 100), true);
    if (data.finished)
      profile._prepareToLoad();
  }

  _resetProfiles() {
    this._reset();
  }

  _snapshotReceived(profile) {
    if (this._profileBeingRecorded === profile)
      this.setProfileBeingRecorded(null);
    this.dispatchEventToListeners(Profiler.HeapSnapshotProfileType.SnapshotReceived, profile);
  }
};

Profiler.HeapSnapshotProfileType.TypeId = 'HEAP';
Profiler.HeapSnapshotProfileType.SnapshotReceived = 'SnapshotReceived';

/**
 * @unrestricted
 */
Profiler.TrackingHeapSnapshotProfileType = class extends Profiler.HeapSnapshotProfileType {
  constructor() {
    super(Profiler.TrackingHeapSnapshotProfileType.TypeId, Common.UIString('Record Allocation Timeline'));
  }

  /**
   * @override
   * @param {!SDK.Target} target
   */
  targetAdded(target) {
    super.targetAdded(target);
    target.heapProfilerModel.addEventListener(
        SDK.HeapProfilerModel.Events.HeapStatsUpdate, this._heapStatsUpdate, this);
    target.heapProfilerModel.addEventListener(
        SDK.HeapProfilerModel.Events.LastSeenObjectId, this._lastSeenObjectId, this);
  }

  /**
   * @override
   * @param {!SDK.Target} target
   */
  targetRemoved(target) {
    super.targetRemoved(target);
    target.heapProfilerModel.removeEventListener(
        SDK.HeapProfilerModel.Events.HeapStatsUpdate, this._heapStatsUpdate, this);
    target.heapProfilerModel.removeEventListener(
        SDK.HeapProfilerModel.Events.LastSeenObjectId, this._lastSeenObjectId, this);
  }

  /**
   * @param {!Common.Event} event
   */
  _heapStatsUpdate(event) {
    if (!this._profileSamples)
      return;
    var samples = /** @type {!Array.<number>} */ (event.data);
    var index;
    for (var i = 0; i < samples.length; i += 3) {
      index = samples[i];
      var size = samples[i + 2];
      this._profileSamples.sizes[index] = size;
      if (!this._profileSamples.max[index])
        this._profileSamples.max[index] = size;
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _lastSeenObjectId(event) {
    var profileSamples = this._profileSamples;
    if (!profileSamples)
      return;
    var data = /** @type {{lastSeenObjectId: number, timestamp: number}} */ (event.data);
    var currentIndex = Math.max(profileSamples.ids.length, profileSamples.max.length - 1);
    profileSamples.ids[currentIndex] = data.lastSeenObjectId;
    if (!profileSamples.max[currentIndex]) {
      profileSamples.max[currentIndex] = 0;
      profileSamples.sizes[currentIndex] = 0;
    }
    profileSamples.timestamps[currentIndex] = data.timestamp;
    if (profileSamples.totalTime < data.timestamp - profileSamples.timestamps[0])
      profileSamples.totalTime *= 2;
    this.dispatchEventToListeners(Profiler.TrackingHeapSnapshotProfileType.HeapStatsUpdate, this._profileSamples);
    this._profileBeingRecorded.updateStatus(null, true);
  }

  /**
   * @override
   * @return {boolean}
   */
  hasTemporaryView() {
    return true;
  }

  get buttonTooltip() {
    return this._recording ? Common.UIString('Stop recording heap profile') :
                             Common.UIString('Start recording heap profile');
  }

  /**
   * @override
   * @return {boolean}
   */
  isInstantProfile() {
    return false;
  }

  /**
   * @override
   * @return {boolean}
   */
  buttonClicked() {
    return this._toggleRecording();
  }

  _startRecordingProfile() {
    if (this.profileBeingRecorded())
      return;
    this._addNewProfile();
    var recordAllocationStacks = Common.moduleSetting('recordAllocationStacks').get();
    this.profileBeingRecorded().target().heapProfilerAgent().startTrackingHeapObjects(recordAllocationStacks);
  }

  _addNewProfile() {
    var target = UI.context.flavor(SDK.Target);
    this.setProfileBeingRecorded(new Profiler.HeapProfileHeader(target, this, undefined));
    this._profileSamples = new Profiler.TrackingHeapSnapshotProfileType.Samples();
    this._profileBeingRecorded._profileSamples = this._profileSamples;
    this._recording = true;
    this.addProfile(this._profileBeingRecorded);
    this._profileBeingRecorded.updateStatus(Common.UIString('Recording\u2026'));
    this.dispatchEventToListeners(Profiler.TrackingHeapSnapshotProfileType.TrackingStarted);
  }

  _stopRecordingProfile() {
    this._profileBeingRecorded.updateStatus(Common.UIString('Snapshotting\u2026'));
    /**
     * @param {?string} error
     * @this {Profiler.HeapSnapshotProfileType}
     */
    function didTakeHeapSnapshot(error) {
      var profile = this.profileBeingRecorded();
      if (!profile)
        return;
      profile._finishLoad();
      this._profileSamples = null;
      this.setProfileBeingRecorded(null);
      this.dispatchEventToListeners(Profiler.ProfileType.Events.ProfileComplete, profile);
    }

    this._profileBeingRecorded.target().heapProfilerAgent().stopTrackingHeapObjects(
        true, didTakeHeapSnapshot.bind(this));
    this._recording = false;
    this.dispatchEventToListeners(Profiler.TrackingHeapSnapshotProfileType.TrackingStopped);
  }

  _toggleRecording() {
    if (this._recording)
      this._stopRecordingProfile();
    else
      this._startRecordingProfile();
    return this._recording;
  }

  /**
   * @override
   * @return {string}
   */
  fileExtension() {
    return '.heaptimeline';
  }

  get treeItemTitle() {
    return Common.UIString('ALLOCATION TIMELINES');
  }

  get description() {
    return Common.UIString(
        'Allocation timelines show memory allocations from your heap over time. Use this profile type to isolate memory leaks.');
  }

  /**
   * @override
   */
  _resetProfiles() {
    var wasRecording = this._recording;
    // Clear current profile to avoid stopping backend.
    this.setProfileBeingRecorded(null);
    super._resetProfiles();
    this._profileSamples = null;
    if (wasRecording)
      this._addNewProfile();
  }

  /**
   * @override
   */
  profileBeingRecordedRemoved() {
    this._stopRecordingProfile();
    this._profileSamples = null;
  }
};

Profiler.TrackingHeapSnapshotProfileType.TypeId = 'HEAP-RECORD';

Profiler.TrackingHeapSnapshotProfileType.HeapStatsUpdate = 'HeapStatsUpdate';
Profiler.TrackingHeapSnapshotProfileType.TrackingStarted = 'TrackingStarted';
Profiler.TrackingHeapSnapshotProfileType.TrackingStopped = 'TrackingStopped';

/**
 * @unrestricted
 */
Profiler.TrackingHeapSnapshotProfileType.Samples = class {
  constructor() {
    /** @type {!Array.<number>} */
    this.sizes = [];
    /** @type {!Array.<number>} */
    this.ids = [];
    /** @type {!Array.<number>} */
    this.timestamps = [];
    /** @type {!Array.<number>} */
    this.max = [];
    /** @type {number} */
    this.totalTime = 30000;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapProfileHeader = class extends Profiler.ProfileHeader {
  /**
   * @param {?SDK.Target} target
   * @param {!Profiler.HeapSnapshotProfileType} type
   * @param {string=} title
   */
  constructor(target, type, title) {
    super(target, type, title || Common.UIString('Snapshot %d', type.nextProfileUid()));
    this.maxJSObjectId = -1;
    /**
     * @type {?Profiler.HeapSnapshotWorkerProxy}
     */
    this._workerProxy = null;
    /**
     * @type {?Common.OutputStream}
     */
    this._receiver = null;
    /**
     * @type {?Profiler.HeapSnapshotProxy}
     */
    this._snapshotProxy = null;
    /**
     * @type {!Promise.<!Profiler.HeapSnapshotProxy>}
     */
    this._loadPromise = new Promise(loadResolver.bind(this));
    this._totalNumberOfChunks = 0;
    this._bufferedWriter = null;

    /**
     * @param {function(!Profiler.HeapSnapshotProxy)} fulfill
     * @this {Profiler.HeapProfileHeader}
     */
    function loadResolver(fulfill) {
      this._fulfillLoad = fulfill;
    }
  }

  /**
   * @override
   * @param {!Profiler.ProfileType.DataDisplayDelegate} dataDisplayDelegate
   * @return {!Profiler.ProfileSidebarTreeElement}
   */
  createSidebarTreeElement(dataDisplayDelegate) {
    return new Profiler.ProfileSidebarTreeElement(dataDisplayDelegate, this, 'heap-snapshot-sidebar-tree-item');
  }

  /**
   * @override
   * @param {!Profiler.ProfileType.DataDisplayDelegate} dataDisplayDelegate
   * @return {!Profiler.HeapSnapshotView}
   */
  createView(dataDisplayDelegate) {
    return new Profiler.HeapSnapshotView(dataDisplayDelegate, this);
  }

  _prepareToLoad() {
    console.assert(!this._receiver, 'Already loading');
    this._setupWorker();
    this.updateStatus(Common.UIString('Loading\u2026'), true);
  }

  _finishLoad() {
    if (!this._wasDisposed)
      this._receiver.close();
    if (this._bufferedWriter) {
      this._bufferedWriter.finishWriting(this._didWriteToTempFile.bind(this));
      this._bufferedWriter = null;
    }
  }

  _didWriteToTempFile(tempFile) {
    if (this._wasDisposed) {
      if (tempFile)
        tempFile.remove();
      return;
    }
    this._tempFile = tempFile;
    if (!tempFile)
      this._failedToCreateTempFile = true;
    if (this._onTempFileReady) {
      this._onTempFileReady();
      this._onTempFileReady = null;
    }
  }

  _setupWorker() {
    /**
     * @this {Profiler.HeapProfileHeader}
     */
    function setProfileWait(event) {
      this.updateStatus(null, event.data);
    }
    console.assert(!this._workerProxy, 'HeapSnapshotWorkerProxy already exists');
    this._workerProxy = new Profiler.HeapSnapshotWorkerProxy(this._handleWorkerEvent.bind(this));
    this._workerProxy.addEventListener('wait', setProfileWait, this);
    this._receiver = this._workerProxy.createLoader(this.uid, this._snapshotReceived.bind(this));
  }

  /**
   * @param {string} eventName
   * @param {*} data
   */
  _handleWorkerEvent(eventName, data) {
    if (Profiler.HeapSnapshotProgressEvent.BrokenSnapshot === eventName) {
      var error = /** @type {string} */ (data);
      Common.console.error(error);
      return;
    }

    if (Profiler.HeapSnapshotProgressEvent.Update !== eventName)
      return;
    var subtitle = /** @type {string} */ (data);
    this.updateStatus(subtitle);
  }

  /**
   * @override
   */
  dispose() {
    if (this._workerProxy)
      this._workerProxy.dispose();
    this.removeTempFile();
    this._wasDisposed = true;
  }

  _didCompleteSnapshotTransfer() {
    if (!this._snapshotProxy)
      return;
    this.updateStatus(Number.bytesToString(this._snapshotProxy.totalSize), false);
  }

  /**
   * @param {string} chunk
   */
  transferChunk(chunk) {
    if (!this._bufferedWriter)
      this._bufferedWriter = new Bindings.DeferredTempFile('heap-profiler', String(this.uid));
    this._bufferedWriter.write([chunk]);

    ++this._totalNumberOfChunks;
    this._receiver.write(chunk);
  }

  _snapshotReceived(snapshotProxy) {
    if (this._wasDisposed)
      return;
    this._receiver = null;
    this._snapshotProxy = snapshotProxy;
    this.maxJSObjectId = snapshotProxy.maxJSObjectId();
    this._didCompleteSnapshotTransfer();
    this._workerProxy.startCheckingForLongRunningCalls();
    this.notifySnapshotReceived();
  }

  notifySnapshotReceived() {
    this._fulfillLoad(this._snapshotProxy);
    this._profileType._snapshotReceived(this);
    if (this.canSaveToFile())
      this.dispatchEventToListeners(Profiler.ProfileHeader.Events.ProfileReceived);
  }

  // Hook point for tests.
  _wasShown() {
  }

  /**
   * @override
   * @return {boolean}
   */
  canSaveToFile() {
    return !this.fromFile() && !!this._snapshotProxy;
  }

  /**
   * @override
   */
  saveToFile() {
    var fileOutputStream = new Bindings.FileOutputStream();

    /**
     * @param {boolean} accepted
     * @this {Profiler.HeapProfileHeader}
     */
    function onOpen(accepted) {
      if (!accepted)
        return;
      if (this._failedToCreateTempFile) {
        Common.console.error('Failed to open temp file with heap snapshot');
        fileOutputStream.close();
      } else if (this._tempFile) {
        var delegate = new Profiler.SaveSnapshotOutputStreamDelegate(this);
        this._tempFile.copyToOutputStream(fileOutputStream, delegate);
      } else {
        this._onTempFileReady = onOpen.bind(this, accepted);
        this._updateSaveProgress(0, 1);
      }
    }
    this._fileName = this._fileName || 'Heap-' + new Date().toISO8601Compact() + this._profileType.fileExtension();
    fileOutputStream.open(this._fileName, onOpen.bind(this));
  }

  _updateSaveProgress(value, total) {
    var percentValue = ((total ? (value / total) : 0) * 100).toFixed(0);
    this.updateStatus(Common.UIString('Saving\u2026 %d%%', percentValue));
  }

  /**
   * @override
   * @param {!File} file
   */
  loadFromFile(file) {
    this.updateStatus(Common.UIString('Loading\u2026'), true);
    this._setupWorker();
    var delegate = new Profiler.HeapSnapshotLoadFromFileDelegate(this);
    var fileReader = this._createFileReader(file, delegate);
    fileReader.start(this._receiver);
  }

  _createFileReader(file, delegate) {
    return new Bindings.ChunkedFileReader(file, 10000000, delegate);
  }
};

/**
 * @implements {Bindings.OutputStreamDelegate}
 * @unrestricted
 */
Profiler.HeapSnapshotLoadFromFileDelegate = class {
  constructor(snapshotHeader) {
    this._snapshotHeader = snapshotHeader;
  }

  /**
   * @override
   */
  onTransferStarted() {
  }

  /**
   * @override
   * @param {!Bindings.ChunkedReader} reader
   */
  onChunkTransferred(reader) {
  }

  /**
   * @override
   */
  onTransferFinished() {
  }

  /**
   * @override
   * @param {!Bindings.ChunkedReader} reader
   * @param {!Event} e
   */
  onError(reader, e) {
    var subtitle;
    switch (e.target.error.code) {
      case e.target.error.NOT_FOUND_ERR:
        subtitle = Common.UIString('\'%s\' not found.', reader.fileName());
        break;
      case e.target.error.NOT_READABLE_ERR:
        subtitle = Common.UIString('\'%s\' is not readable', reader.fileName());
        break;
      case e.target.error.ABORT_ERR:
        return;
      default:
        subtitle = Common.UIString('\'%s\' error %d', reader.fileName(), e.target.error.code);
    }
    this._snapshotHeader.updateStatus(subtitle);
  }
};

/**
 * @implements {Bindings.OutputStreamDelegate}
 * @unrestricted
 */
Profiler.SaveSnapshotOutputStreamDelegate = class {
  /**
   * @param {!Profiler.HeapProfileHeader} profileHeader
   */
  constructor(profileHeader) {
    this._profileHeader = profileHeader;
  }

  /**
   * @override
   */
  onTransferStarted() {
    this._profileHeader._updateSaveProgress(0, 1);
  }

  /**
   * @override
   */
  onTransferFinished() {
    this._profileHeader._didCompleteSnapshotTransfer();
  }

  /**
   * @override
   * @param {!Bindings.ChunkedReader} reader
   */
  onChunkTransferred(reader) {
    this._profileHeader._updateSaveProgress(reader.loadedSize(), reader.fileSize());
  }

  /**
   * @override
   * @param {!Bindings.ChunkedReader} reader
   * @param {!Event} event
   */
  onError(reader, event) {
    Common.console.error(
        'Failed to read heap snapshot from temp file: ' + /** @type {!ErrorEvent} */ (event).message);
    this.onTransferFinished();
  }
};

/**
 * @unrestricted
 */
Profiler.HeapTrackingOverviewGrid = class extends UI.VBox {
  /**
   * @param {!Profiler.HeapProfileHeader} heapProfileHeader
   */
  constructor(heapProfileHeader) {
    super();
    this.element.id = 'heap-recording-view';
    this.element.classList.add('heap-tracking-overview');

    this._overviewContainer = this.element.createChild('div', 'heap-overview-container');
    this._overviewGrid = new UI.OverviewGrid('heap-recording');
    this._overviewGrid.element.classList.add('fill');

    this._overviewCanvas = this._overviewContainer.createChild('canvas', 'heap-recording-overview-canvas');
    this._overviewContainer.appendChild(this._overviewGrid.element);
    this._overviewCalculator = new Profiler.HeapTrackingOverviewGrid.OverviewCalculator();
    this._overviewGrid.addEventListener(UI.OverviewGrid.Events.WindowChanged, this._onWindowChanged, this);

    this._profileSamples = heapProfileHeader.fromFile() ? new Profiler.TrackingHeapSnapshotProfileType.Samples() :
                                                          heapProfileHeader._profileSamples;
    this._profileType = heapProfileHeader.profileType();
    if (!heapProfileHeader.fromFile() && heapProfileHeader.profileType().profileBeingRecorded() === heapProfileHeader) {
      this._profileType.addEventListener(
          Profiler.TrackingHeapSnapshotProfileType.HeapStatsUpdate, this._onHeapStatsUpdate, this);
      this._profileType.addEventListener(
          Profiler.TrackingHeapSnapshotProfileType.TrackingStopped, this._onStopTracking, this);
    }
    this._windowLeft = 0.0;
    this._windowRight = 1.0;
    this._overviewGrid.setWindow(this._windowLeft, this._windowRight);
    this._yScale = new Profiler.HeapTrackingOverviewGrid.SmoothScale();
    this._xScale = new Profiler.HeapTrackingOverviewGrid.SmoothScale();
  }

  dispose() {
    this._onStopTracking();
  }

  _onStopTracking() {
    this._profileType.removeEventListener(
        Profiler.TrackingHeapSnapshotProfileType.HeapStatsUpdate, this._onHeapStatsUpdate, this);
    this._profileType.removeEventListener(
        Profiler.TrackingHeapSnapshotProfileType.TrackingStopped, this._onStopTracking, this);
  }

  _onHeapStatsUpdate(event) {
    this._profileSamples = event.data;
    this._scheduleUpdate();
  }

  /**
   * @param {?Profiler.HeapSnapshotCommon.Samples} samples
   */
  _setSamples(samples) {
    if (!samples)
      return;
    console.assert(!this._profileSamples.timestamps.length, 'Should only call this method when loading from file.');
    console.assert(samples.timestamps.length);
    this._profileSamples = new Profiler.TrackingHeapSnapshotProfileType.Samples();
    this._profileSamples.sizes = samples.sizes;
    this._profileSamples.ids = samples.lastAssignedIds;
    this._profileSamples.timestamps = samples.timestamps;
    this._profileSamples.max = samples.sizes;
    this._profileSamples.totalTime = /** @type{number} */ (samples.timestamps.peekLast());
    this.update();
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  _drawOverviewCanvas(width, height) {
    if (!this._profileSamples)
      return;
    var profileSamples = this._profileSamples;
    var sizes = profileSamples.sizes;
    var topSizes = profileSamples.max;
    var timestamps = profileSamples.timestamps;
    var startTime = timestamps[0];
    var endTime = timestamps[timestamps.length - 1];

    var scaleFactor = this._xScale.nextScale(width / profileSamples.totalTime);
    var maxSize = 0;
    /**
     * @param {!Array.<number>} sizes
     * @param {function(number, number):void} callback
     */
    function aggregateAndCall(sizes, callback) {
      var size = 0;
      var currentX = 0;
      for (var i = 1; i < timestamps.length; ++i) {
        var x = Math.floor((timestamps[i] - startTime) * scaleFactor);
        if (x !== currentX) {
          if (size)
            callback(currentX, size);
          size = 0;
          currentX = x;
        }
        size += sizes[i];
      }
      callback(currentX, size);
    }

    /**
     * @param {number} x
     * @param {number} size
     */
    function maxSizeCallback(x, size) {
      maxSize = Math.max(maxSize, size);
    }

    aggregateAndCall(sizes, maxSizeCallback);

    var yScaleFactor = this._yScale.nextScale(maxSize ? height / (maxSize * 1.1) : 0.0);

    this._overviewCanvas.width = width * window.devicePixelRatio;
    this._overviewCanvas.height = height * window.devicePixelRatio;
    this._overviewCanvas.style.width = width + 'px';
    this._overviewCanvas.style.height = height + 'px';

    var context = this._overviewCanvas.getContext('2d');
    context.scale(window.devicePixelRatio, window.devicePixelRatio);

    context.beginPath();
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(192, 192, 192, 0.6)';
    var currentX = (endTime - startTime) * scaleFactor;
    context.moveTo(currentX, height - 1);
    context.lineTo(currentX, 0);
    context.stroke();
    context.closePath();

    var gridY;
    var gridValue;
    var gridLabelHeight = 14;
    if (yScaleFactor) {
      const maxGridValue = (height - gridLabelHeight) / yScaleFactor;
      // The round value calculation is a bit tricky, because
      // it has a form k*10^n*1024^m, where k=[1,5], n=[0..3], m is an integer,
      // e.g. a round value 10KB is 10240 bytes.
      gridValue = Math.pow(1024, Math.floor(Math.log(maxGridValue) / Math.log(1024)));
      gridValue *= Math.pow(10, Math.floor(Math.log(maxGridValue / gridValue) / Math.LN10));
      if (gridValue * 5 <= maxGridValue)
        gridValue *= 5;
      gridY = Math.round(height - gridValue * yScaleFactor - 0.5) + 0.5;
      context.beginPath();
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      context.moveTo(0, gridY);
      context.lineTo(width, gridY);
      context.stroke();
      context.closePath();
    }

    /**
     * @param {number} x
     * @param {number} size
     */
    function drawBarCallback(x, size) {
      context.moveTo(x, height - 1);
      context.lineTo(x, Math.round(height - size * yScaleFactor - 1));
    }

    context.beginPath();
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(192, 192, 192, 0.6)';
    aggregateAndCall(topSizes, drawBarCallback);
    context.stroke();
    context.closePath();

    context.beginPath();
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(0, 0, 192, 0.8)';
    aggregateAndCall(sizes, drawBarCallback);
    context.stroke();
    context.closePath();

    if (gridValue) {
      var label = Number.bytesToString(gridValue);
      var labelPadding = 4;
      var labelX = 0;
      var labelY = gridY - 0.5;
      var labelWidth = 2 * labelPadding + context.measureText(label).width;
      context.beginPath();
      context.textBaseline = 'bottom';
      context.font = '10px ' + window.getComputedStyle(this.element, null).getPropertyValue('font-family');
      context.fillStyle = 'rgba(255, 255, 255, 0.75)';
      context.fillRect(labelX, labelY - gridLabelHeight, labelWidth, gridLabelHeight);
      context.fillStyle = 'rgb(64, 64, 64)';
      context.fillText(label, labelX + labelPadding, labelY);
      context.fill();
      context.closePath();
    }
  }

  /**
   * @override
   */
  onResize() {
    this._updateOverviewCanvas = true;
    this._scheduleUpdate();
  }

  _onWindowChanged() {
    if (!this._updateGridTimerId)
      this._updateGridTimerId = setTimeout(this._updateGrid.bind(this), 10);
  }

  _scheduleUpdate() {
    if (this._updateTimerId)
      return;
    this._updateTimerId = setTimeout(this.update.bind(this), 10);
  }

  _updateBoundaries() {
    this._windowLeft = this._overviewGrid.windowLeft();
    this._windowRight = this._overviewGrid.windowRight();
    this._windowWidth = this._windowRight - this._windowLeft;
  }

  update() {
    this._updateTimerId = null;
    if (!this.isShowing())
      return;
    this._updateBoundaries();
    this._overviewCalculator._updateBoundaries(this);
    this._overviewGrid.updateDividers(this._overviewCalculator);
    this._drawOverviewCanvas(this._overviewContainer.clientWidth, this._overviewContainer.clientHeight - 20);
  }

  _updateGrid() {
    this._updateGridTimerId = 0;
    this._updateBoundaries();
    var ids = this._profileSamples.ids;
    var timestamps = this._profileSamples.timestamps;
    var sizes = this._profileSamples.sizes;
    var startTime = timestamps[0];
    var totalTime = this._profileSamples.totalTime;
    var timeLeft = startTime + totalTime * this._windowLeft;
    var timeRight = startTime + totalTime * this._windowRight;
    var minId = 0;
    var maxId = ids[ids.length - 1] + 1;
    var size = 0;
    for (var i = 0; i < timestamps.length; ++i) {
      if (!timestamps[i])
        continue;
      if (timestamps[i] > timeRight)
        break;
      maxId = ids[i];
      if (timestamps[i] < timeLeft) {
        minId = ids[i];
        continue;
      }
      size += sizes[i];
    }

    this.dispatchEventToListeners(
        Profiler.HeapTrackingOverviewGrid.IdsRangeChanged, {minId: minId, maxId: maxId, size: size});
  }
};

Profiler.HeapTrackingOverviewGrid.IdsRangeChanged = 'IdsRangeChanged';

/**
 * @unrestricted
 */
Profiler.HeapTrackingOverviewGrid.SmoothScale = class {
  constructor() {
    this._lastUpdate = 0;
    this._currentScale = 0.0;
  }

  /**
   * @param {number} target
   * @return {number}
   */
  nextScale(target) {
    target = target || this._currentScale;
    if (this._currentScale) {
      var now = Date.now();
      var timeDeltaMs = now - this._lastUpdate;
      this._lastUpdate = now;
      var maxChangePerSec = 20;
      var maxChangePerDelta = Math.pow(maxChangePerSec, timeDeltaMs / 1000);
      var scaleChange = target / this._currentScale;
      this._currentScale *= Number.constrain(scaleChange, 1 / maxChangePerDelta, maxChangePerDelta);
    } else {
      this._currentScale = target;
    }
    return this._currentScale;
  }
};

/**
 * @implements {UI.TimelineGrid.Calculator}
 * @unrestricted
 */
Profiler.HeapTrackingOverviewGrid.OverviewCalculator = class {
  /**
   * @override
   * @return {number}
   */
  paddingLeft() {
    return 0;
  }

  /**
   * @param {!Profiler.HeapTrackingOverviewGrid} chart
   */
  _updateBoundaries(chart) {
    this._minimumBoundaries = 0;
    this._maximumBoundaries = chart._profileSamples.totalTime;
    this._xScaleFactor = chart._overviewContainer.clientWidth / this._maximumBoundaries;
  }

  /**
   * @override
   * @param {number} time
   * @return {number}
   */
  computePosition(time) {
    return (time - this._minimumBoundaries) * this._xScaleFactor;
  }

  /**
   * @override
   * @param {number} value
   * @param {number=} precision
   * @return {string}
   */
  formatValue(value, precision) {
    return Number.secondsToString(value / 1000, !!precision);
  }

  /**
   * @override
   * @return {number}
   */
  maximumBoundary() {
    return this._maximumBoundaries;
  }

  /**
   * @override
   * @return {number}
   */
  minimumBoundary() {
    return this._minimumBoundaries;
  }

  /**
   * @override
   * @return {number}
   */
  zeroTime() {
    return this._minimumBoundaries;
  }

  /**
   * @override
   * @return {number}
   */
  boundarySpan() {
    return this._maximumBoundaries - this._minimumBoundaries;
  }
};

/**
 * @unrestricted
 */
Profiler.HeapSnapshotStatisticsView = class extends UI.VBox {
  constructor() {
    super();
    this.setMinimumSize(50, 25);
    this._pieChart = new UI.PieChart(150, Profiler.HeapSnapshotStatisticsView._valueFormatter, true);
    this._pieChart.element.classList.add('heap-snapshot-stats-pie-chart');
    this.element.appendChild(this._pieChart.element);
    this._labels = this.element.createChild('div', 'heap-snapshot-stats-legend');
  }

  /**
   * @param {number} value
   * @return {string}
   */
  static _valueFormatter(value) {
    return Common.UIString('%s KB', Number.withThousandsSeparator(Math.round(value / 1024)));
  }

  /**
   * @param {number} value
   */
  setTotal(value) {
    this._pieChart.setTotal(value);
  }

  /**
   * @param {number} value
   * @param {string} name
   * @param {string=} color
   */
  addRecord(value, name, color) {
    if (color)
      this._pieChart.addSlice(value, color);

    var node = this._labels.createChild('div');
    var swatchDiv = node.createChild('div', 'heap-snapshot-stats-swatch');
    var nameDiv = node.createChild('div', 'heap-snapshot-stats-name');
    var sizeDiv = node.createChild('div', 'heap-snapshot-stats-size');
    if (color)
      swatchDiv.style.backgroundColor = color;
    else
      swatchDiv.classList.add('heap-snapshot-stats-empty-swatch');
    nameDiv.textContent = name;
    sizeDiv.textContent = Profiler.HeapSnapshotStatisticsView._valueFormatter(value);
  }
};


/**
 * @unrestricted
 */
Profiler.HeapAllocationStackView = class extends UI.Widget {
  /**
   * @param {?SDK.Target} target
   */
  constructor(target) {
    super();
    this._target = target;
    this._linkifier = new Components.Linkifier();
  }

  /**
   * @param {!Profiler.HeapSnapshotProxy} snapshot
   * @param {number} snapshotNodeIndex
   */
  setAllocatedObject(snapshot, snapshotNodeIndex) {
    this.clear();
    snapshot.allocationStack(snapshotNodeIndex, this._didReceiveAllocationStack.bind(this));
  }

  clear() {
    this.element.removeChildren();
    this._linkifier.reset();
  }

  /**
   * @param {?Array.<!Profiler.HeapSnapshotCommon.AllocationStackFrame>} frames
   */
  _didReceiveAllocationStack(frames) {
    if (!frames) {
      var stackDiv = this.element.createChild('div', 'no-heap-allocation-stack');
      stackDiv.createTextChild(Common.UIString(
          'Stack was not recorded for this object because it had been allocated before this profile recording started.'));
      return;
    }

    var stackDiv = this.element.createChild('div', 'heap-allocation-stack');
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      var frameDiv = stackDiv.createChild('div', 'stack-frame');
      var name = frameDiv.createChild('div');
      name.textContent = UI.beautifyFunctionName(frame.functionName);
      if (frame.scriptId) {
        var urlElement = this._linkifier.linkifyScriptLocation(
            this._target, String(frame.scriptId), frame.scriptName, frame.line - 1, frame.column - 1);
        frameDiv.appendChild(urlElement);
      }
    }
  }
};
