import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { createTaskIndicatorStore } from '../lib/task-indicator-store.js'

function createFakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map()
  return {
    get now() {
      return now
    },
    get activeCount() {
      return timers.size
    },
    delays() {
      return [...timers.values()].map((item) => item.delay)
    },
    setTimer(callback, delay = 0) {
      const id = ++nextId
      timers.set(id, { id, callback, at: now + delay, delay })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    async advance(ms) {
      const target = now + ms
      while (true) {
        let earliest = undefined
        for (const item of timers.values()) {
          if (item.at <= target && (!earliest || item.at < earliest.at || (item.at === earliest.at && item.id < earliest.id))) {
            earliest = item
          }
        }
        if (!earliest) break
        timers.delete(earliest.id)
        now = earliest.at
        earliest.callback()
        await flushMicrotasks()
      }
      now = target
      await flushMicrotasks()
    },
  }
}

async function flushMicrotasks(turns = 4) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve()
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('快照结构稳定、默认参数校验及无 sessionId 时不发起请求', async () => {
  assert.throws(() => createTaskIndicatorStore(), TypeError)
  assert.throws(() => createTaskIndicatorStore({ fetchTasks: 'invalid' }), TypeError)
  assert.throws(() => createTaskIndicatorStore({ fetchTasks: async () => ({ revision: 0, tasks: [] }), pollInterval: -1 }), RangeError)
  assert.throws(() => createTaskIndicatorStore({ fetchTasks: async () => ({ revision: 0, tasks: [] }), setTimer: 123 }), TypeError)
  assert.throws(() => createTaskIndicatorStore({ fetchTasks: async () => ({ revision: 0, tasks: [] }), clearTimer: 123 }), TypeError)
  assert.throws(() => createTaskIndicatorStore({ fetchTasks: async () => ({ revision: 0, tasks: [] }), isVisible: 'yes' }), TypeError)

  const clock = createFakeClock()
  const calls = []
  const store = createTaskIndicatorStore({
    fetchTasks: async (parentSessionId, signal) => {
      calls.push({ parentSessionId, signal })
      return { revision: 1, tasks: [] }
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  for (const emptyId of [undefined, null, '', '   ']) {
    const snapA = store.getSnapshot(emptyId)
    const snapB = store.getSnapshot(emptyId)
    assert.equal(snapA, snapB, '空 sessionId 快照对象引用必须稳定')
    assert.deepEqual(snapA, {
      parentSessionId: emptyId,
      status: 'loading',
      tasks: [],
      revision: 0,
      error: false,
      loadSeq: 0,
      runningCount: 0,
      unreadErrorCount: 0,
      latestActiveChildId: undefined,
      latestErrorChildId: undefined,
    })
    assert.equal(Object.isFrozen(snapA), true)
    assert.equal(Object.isFrozen(snapA.tasks), true)

    const unsub = store.subscribe(emptyId, () => {
      assert.fail('空 sessionId 不应触发订阅通知')
    })
    const unwatch = store.watch(emptyId, { panelVisible: true })
    await store.refresh(emptyId)
    await store.wake(emptyId)
    store.markErrorsRead(emptyId)
    unwatch()
    unsub()
  }

  assert.equal(calls.length, 0)
  assert.equal(clock.activeCount, 0)

  const unwatchedA = store.getSnapshot('session-idle')
  const unwatchedB = store.getSnapshot('session-idle')
  assert.equal(unwatchedA, unwatchedB, '未 watch 的有效 sessionId 快照引用也必须稳定')
  assert.equal(unwatchedA.parentSessionId, 'session-idle')
  assert.equal(unwatchedA.status, 'loading')
  assert.equal(calls.length, 0)

  assert.throws(() => store.subscribe('session-idle', null), TypeError)
  store.dispose()
})

test('运行计数与异常计数规则：区分活动态、四类异常态与 aborted/completed', async () => {
  const clock = createFakeClock()
  let currentTasks = [
    { childId: 'c-starting', status: 'starting', startedAt: 1000, updatedAt: 1500, archived: false },
    { childId: 'c-running', status: 'running', startedAt: 2000, updatedAt: 3500, archived: false },
    { childId: 'c-completed', status: 'completed', startedAt: 3000, updatedAt: 3100, archived: true },
    { childId: 'c-aborted', status: 'aborted', startedAt: 4000, updatedAt: 4100, archived: true },
    { childId: 'c-err', status: 'error', startedAt: 1200, updatedAt: 2200, archived: true },
    { childId: 'c-refusal', status: 'refusal', startedAt: 1300, updatedAt: 2600, archived: true },
    { childId: 'c-interrupted', status: 'interrupted', startedAt: 1400, updatedAt: 2900, archived: true },
    { childId: 'c-max-tokens', status: 'max-tokens', startedAt: 1100, updatedAt: 4500, archived: true },
  ]

  const store = createTaskIndicatorStore({
    fetchTasks: async () => ({ revision: 7, tasks: currentTasks }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  const unwatch = store.watch('session-1')
  await flushMicrotasks()

  const snap = store.getSnapshot('session-1')
  assert.equal(snap, store.getSnapshot('session-1'))
  assert.equal(snap.parentSessionId, 'session-1')
  assert.equal(snap.status, 'ready')
  assert.equal(snap.revision, 7)
  assert.equal(snap.error, false)
  assert.equal(snap.loadSeq, 1)
  assert.equal(snap.tasks.length, 8)
  assert.equal(snap.runningCount, 2, 'starting 与 running 均计入活动数')
  assert.equal(snap.unreadErrorCount, 4, 'error/refusal/interrupted/max-tokens 计入未读异常，aborted/completed 不计入')
  assert.equal(snap.latestActiveChildId, 'c-running')
  assert.equal(snap.latestErrorChildId, 'c-max-tokens')

  // 无时间戳字段时保持调用方已排序顺序（首项优先）
  currentTasks = [
    { childId: 'sorted-first-active', status: 'running' },
    { childId: 'sorted-second-active', status: 'starting' },
    { childId: 'sorted-first-err', status: 'error' },
    { childId: 'sorted-second-err', status: 'refusal' },
  ]
  await store.refresh('session-1')
  const snapNoTime = store.getSnapshot('session-1')
  assert.equal(snapNoTime.runningCount, 2)
  assert.equal(snapNoTime.unreadErrorCount, 2)
  assert.equal(snapNoTime.latestActiveChildId, 'sorted-first-active')
  assert.equal(snapNoTime.latestErrorChildId, 'sorted-first-err')

  unwatch()
  store.dispose()
})

test('未读异常按 childId+updatedAt+status 判定，markErrorsRead 清零且支持新异常再触发', async () => {
  const clock = createFakeClock()
  let tasks = [
    { childId: 'child-a', status: 'error', startedAt: 2000, updatedAt: 2500 },
    { childId: 'child-b', status: 'refusal', startedAt: 1000, updatedAt: 3000 },
  ]

  const store = createTaskIndicatorStore({
    fetchTasks: async () => ({ revision: 1, tasks }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  const events = []
  const unsub = store.subscribe('s-unread', (snapshot) => events.push(snapshot))
  const unwatch = store.watch('s-unread', { panelVisible: true })
  await flushMicrotasks()

  assert.equal(store.getSnapshot('s-unread').unreadErrorCount, 2)
  assert.equal(store.getSnapshot('s-unread').latestErrorChildId, 'child-b')
  assert.equal(events.length, 1)

  // 标记已读：立即清零并通知订阅者
  store.markErrorsRead('s-unread')
  const afterRead = store.getSnapshot('s-unread')
  assert.equal(afterRead.unreadErrorCount, 0)
  assert.equal(afterRead.latestErrorChildId, undefined)
  assert.equal(events.length, 2)

  // 无未读异常时重复调用 markErrorsRead 不改变快照引用、不重复通知
  store.markErrorsRead('s-unread')
  assert.equal(store.getSnapshot('s-unread'), afterRead)
  assert.equal(events.length, 2)

  // 下一轮轮询返回完全相同的 childId+updatedAt+status：仍为已读
  await clock.advance(1500)
  assert.equal(store.getSnapshot('s-unread').unreadErrorCount, 0)
  assert.equal(store.getSnapshot('s-unread').latestErrorChildId, undefined)

  // 同一 child-a 因继续执行产生新的 updatedAt，child-b 不变，另新增 child-c（completed 不算异常）
  tasks = [
    { childId: 'child-b', status: 'refusal', startedAt: 1000, updatedAt: 3000 },
    { childId: 'child-a', status: 'error', startedAt: 2000, updatedAt: 4200 },
    { childId: 'child-c', status: 'completed', startedAt: 3500, updatedAt: 4300 },
  ]
  await clock.advance(1500)
  assert.equal(store.getSnapshot('s-unread').unreadErrorCount, 1)
  assert.equal(store.getSnapshot('s-unread').latestErrorChildId, 'child-a', 'latestErrorChildId 必须指向未读异常而非旧已读异常')

  store.markErrorsRead('s-unread')
  assert.equal(store.getSnapshot('s-unread').unreadErrorCount, 0)

  // 同一 childId + 相同 updatedAt，但异常 status 变化 -> 判定为新异常
  tasks = [
    { childId: 'child-b', status: 'interrupted', startedAt: 1000, updatedAt: 3000 },
    { childId: 'child-a', status: 'error', startedAt: 2000, updatedAt: 4200 },
  ]
  await clock.advance(1500)
  assert.equal(store.getSnapshot('s-unread').unreadErrorCount, 1)
  assert.equal(store.getSnapshot('s-unread').latestErrorChildId, 'child-b')

  unwatch()
  unsub()
  store.dispose()
})

test('共享 watcher 引用计数：顶栏与面板复用单次轮询，按活动任务与 panelVisible 动态启停', async () => {
  const clock = createFakeClock()
  let fetchCount = 0
  let tasks = [{ childId: 'c-1', status: 'running', updatedAt: 100 }]

  const store = createTaskIndicatorStore({
    fetchTasks: async () => {
      fetchCount += 1
      return { revision: fetchCount, tasks }
    },
    pollInterval: 1500,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  // 顶栏 watcher 与两个面板 watcher 同刻挂载，首次只发 1 次请求
  const unwatchHeader = store.watch('s-shared')
  const unwatchPanelA = store.watch('s-shared', { panelVisible: true })
  const unwatchPanelB = store.watch('s-shared', { panelVisible: true })
  await flushMicrotasks()

  assert.equal(fetchCount, 1)
  assert.deepEqual(clock.delays(), [1500])

  // 任务完成进入空闲，但仍有 panelVisible watcher -> 继续每 1500ms 轮询
  tasks = [{ childId: 'c-1', status: 'completed', updatedAt: 200 }]
  await clock.advance(1500)
  assert.equal(fetchCount, 2)
  assert.equal(store.getSnapshot('s-shared').runningCount, 0)
  assert.equal(clock.activeCount, 1)

  // 关闭其中一个面板 watcher，另一个面板 watcher 仍在 -> 继续轮询
  unwatchPanelA()
  unwatchPanelA() // 幂等验证
  assert.equal(clock.activeCount, 1)
  await clock.advance(1500)
  assert.equal(fetchCount, 3)

  // 关闭最后一个面板 watcher，仅剩顶栏 watcher 且无活动任务 -> 立即取消定时器并停止轮询
  unwatchPanelB()
  assert.equal(clock.activeCount, 0)
  await clock.advance(6000)
  assert.equal(fetchCount, 3, '空闲仅顶栏 watcher 时不得继续轮询')

  // 重新打开面板 watcher -> 立即加载并恢复轮询
  const unwatchPanelReopen = store.watch('s-shared', { panelVisible: true })
  await flushMicrotasks()
  assert.equal(fetchCount, 4)
  assert.equal(clock.activeCount, 1)

  unwatchPanelReopen()
  unwatchHeader()
  assert.equal(clock.activeCount, 0)
  store.dispose()
})

test('空闲休眠与唤醒：仅顶栏 watcher 在活动任务结束后休眠，wake/refresh 立即唤醒并按需续期', async () => {
  const clock = createFakeClock()
  let fetchCount = 0
  let tasks = []

  const store = createTaskIndicatorStore({
    fetchTasks: async () => {
      fetchCount += 1
      return { revision: fetchCount, tasks }
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  // 首次仅顶栏 watch，返回空任务 -> 立即休眠
  const unwatchHeader = store.watch('s-sleep')
  await flushMicrotasks()
  assert.equal(fetchCount, 1)
  assert.equal(clock.activeCount, 0)

  await clock.advance(4500)
  assert.equal(fetchCount, 1)

  // 对未 watch 的其他 session 调用 wake 不触发请求
  await store.wake('unwatched-session')
  assert.equal(fetchCount, 1)

  // 子任务启动，调用 wake 立即唤醒，因存在 starting 任务自动开始 1500ms 轮询
  tasks = [{ childId: 'c-new', status: 'starting', updatedAt: 1000 }]
  await store.wake('s-sleep')
  assert.equal(fetchCount, 2)
  assert.equal(store.getSnapshot('s-sleep').runningCount, 1)
  assert.equal(clock.activeCount, 1)

  // 1500ms 后自动轮询，任务变为 error（终态），停止后续定时器但保留未读异常计数
  tasks = [{ childId: 'c-new', status: 'error', updatedAt: 2000 }]
  await clock.advance(1500)
  assert.equal(fetchCount, 3)
  assert.equal(store.getSnapshot('s-sleep').runningCount, 0)
  assert.equal(store.getSnapshot('s-sleep').unreadErrorCount, 1)
  assert.equal(clock.activeCount, 0, '进入终态后仅顶栏 watcher 自动停止轮询')

  // 休眠期间调用 refresh 也能立即唤醒拉取一次
  tasks = [{ childId: 'c-new', status: 'completed', updatedAt: 3000 }]
  await store.refresh('s-sleep')
  assert.equal(fetchCount, 4)
  assert.equal(store.getSnapshot('s-sleep').unreadErrorCount, 0)
  assert.equal(clock.activeCount, 0)

  unwatchHeader()
  store.dispose()
})

test('在途请求期间调用 wake 会合并补拉一次，避免漏掉刚启动的子任务', async () => {
  const clock = createFakeClock()
  const pending = []
  const store = createTaskIndicatorStore({
    fetchTasks: () => {
      const d = deferred()
      pending.push(d)
      return d.promise
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  const unwatch = store.watch('s-coalesce')
  assert.equal(pending.length, 1)

  // 在第一次请求尚未返回时连续调用 wake，不应 abort 当前请求，但应在返回后立即补拉一次
  const wakePromise = store.wake('s-coalesce')
  void store.wake('s-coalesce')
  assert.equal(pending.length, 1)

  pending[0].resolve({ revision: 1, tasks: [] })
  await flushMicrotasks()
  assert.equal(pending.length, 2, '首个请求结清后立即发起合并后的补拉请求')

  pending[1].resolve({
    revision: 2,
    tasks: [{ childId: 'c-live', status: 'running', updatedAt: 500 }],
  })
  await wakePromise

  assert.equal(store.getSnapshot('s-coalesce').runningCount, 1)
  assert.equal(clock.activeCount, 1, '补拉发现活动任务后继续轮询')

  unwatch()
  store.dispose()
})

test('页面可见性控制：不可见时暂停加载与轮询，恢复可见后由 wake 触发加载', async () => {
  const clock = createFakeClock()
  let visible = false
  let fetchCount = 0
  let tasks = [{ childId: 'c-vis', status: 'running', updatedAt: 100 }]

  const store = createTaskIndicatorStore({
    fetchTasks: async () => {
      fetchCount += 1
      return { revision: fetchCount, tasks }
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isVisible: () => visible,
  })

  // 页面隐藏时注册 watch 和调用 wake 均不发请求
  const unwatch = store.watch('s-vis', { panelVisible: true })
  await store.wake('s-vis')
  await clock.advance(3000)
  assert.equal(fetchCount, 0)
  assert.equal(clock.activeCount, 0)

  // 页面恢复可见并由外部调用 wake -> 立即加载并恢复轮询
  visible = true
  await store.wake('s-vis')
  assert.equal(fetchCount, 1)
  assert.equal(store.getSnapshot('s-vis').runningCount, 1)
  assert.equal(clock.activeCount, 1)

  await clock.advance(1500)
  assert.equal(fetchCount, 2)
  assert.equal(clock.activeCount, 1)

  // 轮询等待期间页面切到后台 -> 定时器到期后自动暂停，不再续期
  visible = false
  await clock.advance(1500)
  assert.equal(fetchCount, 2)
  assert.equal(clock.activeCount, 0)
  await clock.advance(6000)
  assert.equal(fetchCount, 2)

  // 再次切回前台并 wake -> 立即恢复
  visible = true
  await store.wake('s-vis')
  assert.equal(fetchCount, 3)
  assert.equal(clock.activeCount, 1)

  unwatch()
  store.dispose()
})

test('session 切换、refresh 中止与过期响应防串扰，且短暂失败保留已有 tasks', async () => {
  const clock = createFakeClock()
  const requests = []

  const store = createTaskIndicatorStore({
    fetchTasks: (parentSessionId, signal) => {
      const d = deferred()
      requests.push({ parentSessionId, signal, ...d })
      return d.promise
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  const s1Events = []
  const s2Events = []
  const unsub1 = store.subscribe('session-1', (snap) => s1Events.push(snap))
  const unsub2 = store.subscribe('session-2', (snap) => s2Events.push(snap))

  // 1. 开始 watch session-1，随后立即切换到 session-2（取消 watch session-1）
  const unwatch1 = store.watch('session-1', { panelVisible: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].parentSessionId, 'session-1')
  assert.equal(requests[0].signal.aborted, false)

  unwatch1()
  assert.equal(requests[0].signal.aborted, true, '最后一个 watcher 解绑必须立即 abort 在途请求')

  const unwatch2 = store.watch('session-2', { panelVisible: true })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].parentSessionId, 'session-2')

  // 已 abort 的 session-1 旧请求即使忽略 signal 强行返回或抛错，也不得更新状态或串扰 session-2
  requests[0].resolve({
    revision: 99,
    tasks: [{ childId: 'stale-1', status: 'running', updatedAt: 999 }],
  })
  await flushMicrotasks()
  assert.equal(s1Events.length, 0)
  assert.equal(store.getSnapshot('session-1').status, 'loading')
  assert.equal(store.getSnapshot('session-1').tasks.length, 0)

  // 2. session-2 内调用 refresh：旧在途请求被 abort，且乱序晚归的旧响应不得覆盖新结果
  const refreshPromise = store.refresh('session-2')
  assert.equal(requests[1].signal.aborted, true, 'refresh 必须 abort 同 session 的旧在途请求')
  assert.equal(requests.length, 3)

  requests[2].resolve({
    revision: 10,
    tasks: [{ childId: 'fresh-child', status: 'running', updatedAt: 500 }],
  })
  await refreshPromise
  assert.equal(store.getSnapshot('session-2').status, 'ready')
  assert.equal(store.getSnapshot('session-2').loadSeq, 1)
  assert.equal(store.getSnapshot('session-2').revision, 10)
  assert.deepEqual(
    store.getSnapshot('session-2').tasks.map((t) => t.childId),
    ['fresh-child'],
  )

  // 旧请求 requests[1] 晚一步返回旧数据 -> 完全忽略
  requests[1].resolve({
    revision: 2,
    tasks: [{ childId: 'outdated-child', status: 'error', updatedAt: 100 }],
  })
  await flushMicrotasks()
  assert.equal(store.getSnapshot('session-2').loadSeq, 1)
  assert.equal(store.getSnapshot('session-2').revision, 10)
  assert.equal(store.getSnapshot('session-2').unreadErrorCount, 0)
  assert.deepEqual(
    store.getSnapshot('session-2').tasks.map((t) => t.childId),
    ['fresh-child'],
  )
  assert.equal(s1Events.length, 0, 'session-2 的更新绝不触发 session-1 的订阅者')
  assert.equal(s2Events.length, 1)

  // 3. 下一轮轮询短暂失败：保留已有 tasks、revision、loadSeq 与运行指标，status 保持 ready，error 置为 true
  const preservedTasksRef = store.getSnapshot('session-2').tasks
  await clock.advance(1500)
  assert.equal(requests.length, 4)
  requests[3].reject(new Error('network glitch'))
  await flushMicrotasks()

  const afterGlitch = store.getSnapshot('session-2')
  assert.equal(afterGlitch.status, 'ready', '已有 tasks 时短暂失败保持 ready 以供 TasksPanel 继续渲染列表')
  assert.equal(afterGlitch.error, true)
  assert.equal(afterGlitch.tasks, preservedTasksRef)
  assert.equal(afterGlitch.revision, 10)
  assert.equal(afterGlitch.loadSeq, 1)
  assert.equal(afterGlitch.runningCount, 1)

  // 再下一轮恢复正常 -> error 归位为 false，loadSeq 递增
  await clock.advance(1500)
  assert.equal(requests.length, 5)
  requests[4].resolve({
    revision: 11,
    tasks: [{ childId: 'fresh-child', status: 'completed', updatedAt: 900 }],
  })
  await flushMicrotasks()

  const recovered = store.getSnapshot('session-2')
  assert.equal(recovered.status, 'ready')
  assert.equal(recovered.error, false)
  assert.equal(recovered.revision, 11)
  assert.equal(recovered.loadSeq, 2)
  assert.equal(recovered.runningCount, 0)

  // 4. 首次加载即失败（尚无任何保留 tasks）时，status 为 'error' 且 error 为 true
  const unwatch3 = store.watch('session-empty-fail')
  assert.equal(requests.length, 6)
  requests[5].reject(new Error('unavailable'))
  await flushMicrotasks()
  const initialFail = store.getSnapshot('session-empty-fail')
  assert.equal(initialFail.status, 'error')
  assert.equal(initialFail.error, true)
  assert.deepEqual(initialFail.tasks, [])
  assert.equal(initialFail.loadSeq, 0)

  unwatch2()
  unwatch3()
  unsub1()
  unsub2()
  store.dispose()
})

test('dispose 清理所有定时器、中止在途请求并阻断后续一切操作', async () => {
  const clock = createFakeClock()
  const signals = []
  let callCount = 0

  const store = createTaskIndicatorStore({
    fetchTasks: async (sessionId, signal) => {
      callCount += 1
      signals.push(signal)
      if (sessionId === 's-pending') {
        return new Promise(() => {})
      }
      return {
        revision: 1,
        tasks: [{ childId: 'c-run', status: 'error', updatedAt: 100 }],
      }
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  let notifications = 0
  store.subscribe('s-polled', () => {
    notifications += 1
  })
  store.watch('s-polled', { panelVisible: true })
  store.watch('s-pending', { panelVisible: true })
  await flushMicrotasks()

  assert.equal(callCount, 2)
  assert.equal(notifications, 1)
  assert.equal(clock.activeCount, 1)
  assert.equal(signals[1].aborted, false)

  store.dispose()
  store.dispose() // 幂等

  assert.equal(clock.activeCount, 0, 'dispose 必须清理所有轮询定时器')
  assert.equal(signals[1].aborted, true, 'dispose 必须 abort 所有在途请求')

  const noopUnwatch = store.watch('s-after', { panelVisible: true })
  const noopUnsub = store.subscribe('s-polled', () => {
    notifications += 1
  })
  await store.refresh('s-polled')
  await store.wake('s-polled')
  store.markErrorsRead('s-polled')
  noopUnwatch()
  noopUnsub()

  assert.equal(callCount, 2, 'dispose 后不得再发起任何 fetchTasks 请求')
  assert.equal(notifications, 1, 'dispose 后不得再触发任何订阅回调')
  assert.equal(store.getSnapshot('s-polled').unreadErrorCount, 1)
  assert.equal(store.getSnapshot('s-after').status, 'loading')
})

test('最后一个 watcher 解绑时同步将当前监听周期 signal 置为 aborted，重连后生成全新 signal', async () => {
  const clock = createFakeClock()
  const signals = []
  const store = createTaskIndicatorStore({
    fetchTasks: async (_sessionId, signal) => {
      signals.push(signal)
      return { revision: signals.length, tasks: [{ childId: 'c-1', status: 'running', updatedAt: 10 }] }
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  const unwatchA = store.watch('s-cycle', { panelVisible: true })
  const unwatchB = store.watch('s-cycle')
  await flushMicrotasks()
  assert.equal(signals.length, 1)
  assert.equal(signals[0].aborted, false)

  // 仍余一个 watcher 时不 abort
  unwatchA()
  assert.equal(signals[0].aborted, false)

  // 最后一个 watcher 退出 -> 监听周期 signal 置为 aborted 且定时器清空
  unwatchB()
  assert.equal(signals[0].aborted, true)
  assert.equal(clock.activeCount, 0)

  // 重新 watch -> 使用全新未中止的 signal
  const unwatchC = store.watch('s-cycle')
  await flushMicrotasks()
  assert.equal(signals.length, 2)
  assert.notEqual(signals[1], signals[0])
  assert.equal(signals[1].aborted, false)

  unwatchC()
  assert.equal(signals[1].aborted, true)
  store.dispose()
})

test('纯浏览器/无 Node 与 DOM 全局兼容：在隔离沙箱内自包含运行', async () => {
  const sandbox = vm.createContext(Object.create(null))
  const factory = vm.runInContext(`(${createTaskIndicatorStore.toString()})`, sandbox)
  assert.equal(typeof factory, 'function')

  const timers = []
  const cleared = []
  const store = factory({
    fetchTasks: async (sessionId, signal) => ({
      revision: 3,
      tasks: [{ childId: `${sessionId}-1`, status: signal.aborted ? 'aborted' : 'running', updatedAt: 10 }],
    }),
    setTimer: (fn, delay) => {
      timers.push({ fn, delay })
      return timers.length
    },
    clearTimer: (id) => {
      cleared.push(id)
    },
    isVisible: () => true,
  })

  const unwatch = store.watch('sandbox-session')
  await flushMicrotasks()

  const snap = store.getSnapshot('sandbox-session')
  assert.equal(snap.status, 'ready')
  assert.equal(snap.runningCount, 1)
  assert.equal(snap.latestActiveChildId, 'sandbox-session-1')
  assert.equal(timers.length, 1)

  unwatch()
  assert.deepEqual(cleared, [1])
  store.dispose()
})
