export function createTaskIndicatorStore(options = {}) {
  if (!options || typeof options !== 'object' || typeof options.fetchTasks !== 'function') {
    throw new TypeError('createTaskIndicatorStore requires options.fetchTasks to be a function')
  }
  const { fetchTasks } = options
  const pollInterval = options.pollInterval === undefined ? 1500 : options.pollInterval
  if (typeof pollInterval !== 'number' || !Number.isFinite(pollInterval) || pollInterval < 0) {
    throw new RangeError('options.pollInterval must be a non-negative finite number')
  }
  if (options.setTimer !== undefined && typeof options.setTimer !== 'function') {
    throw new TypeError('options.setTimer must be a function')
  }
  if (options.clearTimer !== undefined && typeof options.clearTimer !== 'function') {
    throw new TypeError('options.clearTimer must be a function')
  }
  if (options.isVisible !== undefined && typeof options.isVisible !== 'function') {
    throw new TypeError('options.isVisible must be a function')
  }

  const setTimer = options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
  const clearTimer = options.clearTimer ?? ((timerId) => globalThis.clearTimeout(timerId))
  const isVisible = options.isVisible ?? (() => true)

  const ACTIVE_STATUSES = new Set(['starting', 'running'])
  const ERROR_STATUSES = new Set(['error', 'refusal', 'interrupted', 'max-tokens'])
  const EMPTY_TASKS = Object.freeze([])

  let disposed = false
  const entries = new Map()
  const emptySnapshots = new Map()

  function isValidSessionId(parentSessionId) {
    return typeof parentSessionId === 'string' && parentSessionId.trim().length > 0
  }

  function isPageVisible() {
    return Boolean(isVisible())
  }

  function createAbortController() {
    if (typeof AbortController === 'function') return new AbortController()
    let aborted = false
    const listeners = new Set()
    const signal = {
      get aborted() { return aborted },
      addEventListener(type, listener) {
        if (type === 'abort' && typeof listener === 'function') listeners.add(listener)
      },
      removeEventListener(type, listener) {
        if (type === 'abort') listeners.delete(listener)
      },
    }
    return {
      signal,
      abort() {
        if (aborted) return
        aborted = true
        for (const listener of [...listeners]) listener()
        listeners.clear()
      },
    }
  }

  function parseTimestamp(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'string' && value.length > 0) {
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
  }

  function rankTimestamp(task) {
    return parseTimestamp(task?.updatedAt)
      ?? parseTimestamp(task?.finishedAt)
      ?? parseTimestamp(task?.startedAt)
  }

  function pickLatestChildId(tasks) {
    let bestTask = undefined
    let bestTime = undefined
    for (const task of tasks) {
      if (typeof task?.childId !== 'string' || task.childId.length === 0) continue
      const time = rankTimestamp(task)
      if (!bestTask) {
        bestTask = task
        bestTime = time
        continue
      }
      if (time !== undefined && (bestTime === undefined || time > bestTime)) {
        bestTask = task
        bestTime = time
      }
    }
    return bestTask?.childId
  }

  function errorSignature(task) {
    const childId = typeof task?.childId === 'string' ? task.childId : ''
    const updatedAt = task?.updatedAt === undefined || task?.updatedAt === null ? null : task.updatedAt
    const status = typeof task?.status === 'string' ? task.status : ''
    return JSON.stringify([childId, updatedAt, status])
  }

  function computeIndicators(tasks, readErrorSignatures) {
    const activeTasks = []
    const unreadErrorTasks = []
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue
      if (ACTIVE_STATUSES.has(task.status)) {
        activeTasks.push(task)
      } else if (ERROR_STATUSES.has(task.status)) {
        if (!readErrorSignatures.has(errorSignature(task))) {
          unreadErrorTasks.push(task)
        }
      }
    }
    return {
      runningCount: activeTasks.length,
      unreadErrorCount: unreadErrorTasks.length,
      latestActiveChildId: pickLatestChildId(activeTasks),
      latestErrorChildId: pickLatestChildId(unreadErrorTasks),
    }
  }

  function buildSnapshot({
    parentSessionId,
    status,
    tasks,
    revision,
    error,
    loadSeq,
    readErrorSignatures,
  }) {
    const indicators = computeIndicators(tasks, readErrorSignatures)
    return Object.freeze({
      parentSessionId,
      status,
      tasks,
      revision,
      error,
      loadSeq,
      runningCount: indicators.runningCount,
      unreadErrorCount: indicators.unreadErrorCount,
      latestActiveChildId: indicators.latestActiveChildId,
      latestErrorChildId: indicators.latestErrorChildId,
    })
  }

  function getEmptySnapshot(parentSessionId) {
    if (emptySnapshots.has(parentSessionId)) return emptySnapshots.get(parentSessionId)
    const snapshot = Object.freeze({
      parentSessionId,
      status: 'loading',
      tasks: EMPTY_TASKS,
      revision: 0,
      error: false,
      loadSeq: 0,
      runningCount: 0,
      unreadErrorCount: 0,
      latestActiveChildId: undefined,
      latestErrorChildId: undefined,
    })
    emptySnapshots.set(parentSessionId, snapshot)
    return snapshot
  }

  function ensureEntry(parentSessionId) {
    let entry = entries.get(parentSessionId)
    if (entry) return entry
    const readErrorSignatures = new Set()
    entry = {
      parentSessionId,
      watchers: new Set(),
      listeners: new Set(),
      readErrorSignatures,
      requestSeq: 0,
      cycleController: undefined,
      inFlight: undefined,
      pendingWake: false,
      timer: undefined,
      timerToken: undefined,
      snapshot: buildSnapshot({
        parentSessionId,
        status: 'loading',
        tasks: EMPTY_TASKS,
        revision: 0,
        error: false,
        loadSeq: 0,
        readErrorSignatures,
      }),
    }
    entries.set(parentSessionId, entry)
    return entry
  }

  function hasPanelWatcher(entry) {
    for (const watcher of entry.watchers) {
      if (watcher.panelVisible) return true
    }
    return false
  }

  function shouldKeepPolling(entry) {
    return hasPanelWatcher(entry) || entry.snapshot.runningCount > 0
  }

  function clearEntryTimer(entry) {
    entry.timerToken = undefined
    if (entry.timer !== undefined) {
      const timerId = entry.timer
      entry.timer = undefined
      clearTimer(timerId)
    }
  }

  function abortEntryInFlight(entry) {
    entry.requestSeq += 1
    entry.pendingWake = false
    const cycle = entry.cycleController
    entry.cycleController = undefined
    const current = entry.inFlight
    entry.inFlight = undefined
    if (cycle) cycle.abort()
    if (current && current.controller !== cycle) current.controller.abort()
  }

  function notify(entry) {
    const currentListeners = [...entry.listeners]
    for (const listener of currentListeners) {
      if (entry.listeners.has(listener)) {
        listener(entry.snapshot)
      }
    }
  }

  function scheduleNextPoll(entry) {
    clearEntryTimer(entry)
    if (disposed || entry.inFlight || entry.watchers.size === 0 || !isPageVisible() || !shouldKeepPolling(entry)) {
      return
    }
    const timerToken = {}
    entry.timerToken = timerToken
    const timerId = setTimer(() => {
      if (entry.timerToken !== timerToken) return
      entry.timerToken = undefined
      entry.timer = undefined
      if (disposed || entry.watchers.size === 0 || !isPageVisible() || !shouldKeepPolling(entry)) return
      void startFetch(entry, { abortCurrent: false })
    }, pollInterval)
    if (entry.timerToken === timerToken) {
      entry.timer = timerId
    } else if (timerId !== undefined) {
      clearTimer(timerId)
    }
  }

  function startFetch(entry, { abortCurrent = false } = {}) {
    if (disposed) return Promise.resolve(entry.snapshot)
    clearEntryTimer(entry)

    if (abortCurrent) {
      abortEntryInFlight(entry)
    } else if (entry.inFlight) {
      return entry.inFlight.promise
    }

    const requestId = ++entry.requestSeq
    if (!entry.cycleController || entry.cycleController.signal.aborted) {
      entry.cycleController = createAbortController()
    }
    const controller = entry.cycleController
    const inFlightRecord = { requestId, controller, promise: undefined }
    entry.inFlight = inFlightRecord

    const promise = (async () => {
      try {
        const result = await fetchTasks(entry.parentSessionId, controller.signal)
        if (disposed || requestId !== entry.requestSeq || controller.signal.aborted) {
          return entry.snapshot
        }
        if (!result || typeof result !== 'object' || !Array.isArray(result.tasks)) {
          throw new Error('invalid-task-list')
        }
        const tasks = result.tasks.length === 0 ? EMPTY_TASKS : Object.freeze([...result.tasks])
        const revision = Number.isFinite(result.revision) ? result.revision : 0
        entry.snapshot = buildSnapshot({
          parentSessionId: entry.parentSessionId,
          status: 'ready',
          tasks,
          revision,
          error: false,
          loadSeq: entry.snapshot.loadSeq + 1,
          readErrorSignatures: entry.readErrorSignatures,
        })
      } catch {
        if (disposed || requestId !== entry.requestSeq || controller.signal.aborted) {
          return entry.snapshot
        }
        const prev = entry.snapshot
        entry.snapshot = buildSnapshot({
          parentSessionId: entry.parentSessionId,
          status: prev.tasks.length > 0 ? 'ready' : 'error',
          tasks: prev.tasks,
          revision: prev.revision,
          error: true,
          loadSeq: prev.loadSeq,
          readErrorSignatures: entry.readErrorSignatures,
        })
      }

      if (entry.inFlight === inFlightRecord) {
        entry.inFlight = undefined
      }

      notify(entry)

      if (disposed || requestId !== entry.requestSeq) {
        return entry.snapshot
      }

      if (entry.pendingWake) {
        entry.pendingWake = false
        if (entry.watchers.size > 0 && isPageVisible()) {
          return startFetch(entry, { abortCurrent: false })
        }
      }

      scheduleNextPoll(entry)
      return entry.snapshot
    })()

    inFlightRecord.promise = promise
    return promise
  }

  function getSnapshot(parentSessionId) {
    if (!isValidSessionId(parentSessionId)) {
      return getEmptySnapshot(parentSessionId)
    }
    const existing = entries.get(parentSessionId)
    if (existing) return existing.snapshot
    if (disposed) return getEmptySnapshot(parentSessionId)
    return ensureEntry(parentSessionId).snapshot
  }

  function subscribe(parentSessionId, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe requires listener to be a function')
    }
    if (disposed || !isValidSessionId(parentSessionId)) {
      return () => {}
    }
    const entry = ensureEntry(parentSessionId)
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
    }
  }

  function watch(parentSessionId, watchOptions = {}) {
    if (disposed || !isValidSessionId(parentSessionId)) {
      return () => {}
    }
    const entry = ensureEntry(parentSessionId)
    const hadWatchers = entry.watchers.size > 0
    const hadPanelWatcher = hasPanelWatcher(entry)
    const watcher = { panelVisible: Boolean(watchOptions?.panelVisible) }
    entry.watchers.add(watcher)

    if (isPageVisible()) {
      const becameWatched = !hadWatchers
      const panelJustOpened = !hadPanelWatcher && watcher.panelVisible
      const neverLoaded = entry.snapshot.loadSeq === 0
      if (becameWatched || panelJustOpened || neverLoaded) {
        if (!entry.inFlight) {
          void startFetch(entry, { abortCurrent: false })
        }
      } else {
        scheduleNextPoll(entry)
      }
    }

    return () => {
      if (!entry.watchers.delete(watcher)) return
      if (disposed) return
      if (entry.watchers.size === 0) {
        clearEntryTimer(entry)
        abortEntryInFlight(entry)
        return
      }
      if (!shouldKeepPolling(entry) || !isPageVisible()) {
        clearEntryTimer(entry)
      }
    }
  }

  function refresh(parentSessionId) {
    if (disposed || !isValidSessionId(parentSessionId)) {
      return Promise.resolve(getSnapshot(parentSessionId))
    }
    const entry = ensureEntry(parentSessionId)
    return startFetch(entry, { abortCurrent: true })
  }

  function wake(parentSessionId) {
    if (disposed || !isValidSessionId(parentSessionId) || !isPageVisible()) {
      return Promise.resolve(getSnapshot(parentSessionId))
    }
    const entry = entries.get(parentSessionId)
    if (!entry || entry.watchers.size === 0) {
      return Promise.resolve(getSnapshot(parentSessionId))
    }
    if (entry.inFlight) {
      entry.pendingWake = true
      return entry.inFlight.promise
    }
    return startFetch(entry, { abortCurrent: false })
  }

  function markErrorsRead(parentSessionId) {
    if (disposed || !isValidSessionId(parentSessionId)) return
    const entry = entries.get(parentSessionId)
    if (!entry) return
    let changed = false
    for (const task of entry.snapshot.tasks) {
      if (task && typeof task === 'object' && ERROR_STATUSES.has(task.status)) {
        const sig = errorSignature(task)
        if (!entry.readErrorSignatures.has(sig)) {
          entry.readErrorSignatures.add(sig)
          changed = true
        }
      }
    }
    if (!changed) return
    const prev = entry.snapshot
    entry.snapshot = buildSnapshot({
      parentSessionId: entry.parentSessionId,
      status: prev.status,
      tasks: prev.tasks,
      revision: prev.revision,
      error: prev.error,
      loadSeq: prev.loadSeq,
      readErrorSignatures: entry.readErrorSignatures,
    })
    notify(entry)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const entry of entries.values()) {
      clearEntryTimer(entry)
      abortEntryInFlight(entry)
      entry.watchers.clear()
      entry.listeners.clear()
    }
  }

  return {
    getSnapshot,
    subscribe,
    watch,
    refresh,
    wake,
    markErrorsRead,
    dispose,
  }
}
