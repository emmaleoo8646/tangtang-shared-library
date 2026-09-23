import { useState } from 'react'
import './App.css'

type ApiState = 'idle' | 'checking' | 'ready' | 'offline'

const entries = [
  { title: '举报处理', detail: '查看待核实内容与处理记录', count: 0 },
  { title: '用户与家庭', detail: '只展示运营所需的最少信息', count: 0 },
  { title: '书籍内容', detail: '处理违规书籍与下架申诉', count: 0 },
]

function App() {
  const [apiState, setApiState] = useState<ApiState>('idle')

  async function checkApi() {
    setApiState('checking')
    try {
      const response = await fetch('http://localhost:3000/health')
      const data = (await response.json()) as { status?: string }
      setApiState(response.ok && data.status === 'ok' ? 'ready' : 'offline')
    } catch {
      setApiState('offline')
    }
  }

  const statusText = {
    idle: '尚未检查',
    checking: '检查中…',
    ready: '连接正常',
    offline: '无法连接',
  }[apiState]

  return (
    <main>
      <header>
        <div className="brand-mark" aria-hidden="true">📚</div>
        <div>
          <p className="eyebrow">TANGTANG LIBRARY</p>
          <h1>糖糖的共享书屋</h1>
        </div>
        <span className="environment">本地开发</span>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">管理员工作台</p>
          <h2>守护每一次安心借阅</h2>
          <p>处理举报、内容和账号异常。交接信息只向订单双方开放。</p>
        </div>
        <div className={`health ${apiState}`}>
          <span className="dot" />
          <div>
            <small>API 状态</small>
            <strong>{statusText}</strong>
          </div>
          <button type="button" onClick={checkApi} disabled={apiState === 'checking'}>
            检查服务
          </button>
        </div>
      </section>

      <section className="grid" aria-label="管理入口">
        {entries.map((entry) => (
          <article key={entry.title}>
            <span className="count">{entry.count}</span>
            <h3>{entry.title}</h3>
            <p>{entry.detail}</p>
            <button type="button" disabled>功能将在安全管理阶段接入</button>
          </article>
        ))}
      </section>

      <footer>开发骨架 · 不包含任何真实家庭或儿童数据</footer>
    </main>
  )
}

export default App
