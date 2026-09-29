import { useEffect, useState } from 'react'
import './App.css'

type Option = { id: string; label: string; active: boolean; sortOrder: number }
type OptionLists = { categories: Option[]; ages: Option[]; conditions: Option[] }
type Overview = { users: { total: number; active: number; new30Days: number }; books: Record<string, number>; loans: Record<string, number>; trend: { day: string; users: number; loans: number }[]; categories: { label: string; count: number }[] }
type User = { id: string; username: string; email: string; displayName: string; status: string; createdAt: string; phoneMasked: string; phoneVerified: boolean; books: number; borrowed: number; lent: number }
type UsersPage = { total: number; page: number; users: User[] }
type Section = 'overview' | 'users' | 'options'

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin${path}`, { method, credentials: 'include', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join('；') : data.message || '操作失败')
  return data as T
}

const kinds = [{ key: 'categories', kind: 'CATEGORY', title: '图书分类' }, { key: 'ages', kind: 'AGE', title: '适读年龄' }, { key: 'conditions', kind: 'CONDITION', title: '新旧程度' }] as const

function App() {
  const [admin, setAdmin] = useState<{ username: string } | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [users, setUsers] = useState<UsersPage | null>(null)
  const [options, setOptions] = useState<OptionLists | null>(null)
  const [page, setPage] = useState(1)
  const [newNames, setNewNames] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void api<{ username: string }>('/me').then(setAdmin).catch(() => {}) }, [])
  useEffect(() => { if (admin) void Promise.all([api<Overview>('/overview'), api<OptionLists>('/options')]).then(([nextOverview, nextOptions]) => { setOverview(nextOverview); setOptions(nextOptions) }).catch(error => setMessage(error.message)) }, [admin])
  useEffect(() => { if (admin) void api<UsersPage>(`/users?page=${page}`).then(setUsers).catch(error => setMessage(error.message)) }, [admin, page])
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
  async function login() { await run(async () => { const value = await api<{ username: string }>('/auth/login', 'POST', { username, password }); setAdmin(value); setPassword('') }) }
  async function logout() { await run(async () => { await api('/auth/logout', 'POST'); setAdmin(null); setOverview(null); setUsers(null); setOptions(null); setRevealed({}) }) }
  async function createOption(kind: string, key: string) { const label = newNames[key]?.trim(); if (!label) return; await run(async () => { await api('/options', 'POST', { kind, label }); setOptions(await api<OptionLists>('/options')); setNewNames(value => ({ ...value, [key]: '' })) }) }
  async function changeOption(option: Option, patch: Partial<Option>) { await run(async () => { await api(`/options/${option.id}`, 'PATCH', patch); setOptions(await api<OptionLists>('/options')); setOverview(await api<Overview>('/overview')) }) }
  async function reveal(user: User) { await run(async () => { const value = await api<{ phone: string }> (`/users/${user.id}/phone`); setRevealed(current => ({ ...current, [user.id]: value.phone || '暂未提供' })) }) }
  const totalBooks = Object.values(overview?.books || {}).reduce((a, b) => a + b, 0)
  const totalLoans = Object.values(overview?.loans || {}).reduce((a, b) => a + b, 0)
  const maxTrend = Math.max(1, ...(overview?.trend || []).map(day => Math.max(day.users, day.loans)))
  return <main className="admin-shell">
    <header className="admin-header"><div className="brand-mark">书</div><div><p className="eyebrow">糖糖的共享书屋</p><h1>管理员工作台</h1></div>{admin && <div className="admin-identity"><span>{admin.username}</span><button className="ghost" onClick={() => void logout()}>退出</button></div>}</header>
    {message && <div className="notice" role="alert">{message}</div>}
    {!admin ? <section className="login-panel"><p className="eyebrow">独立管理员账号</p><h2>登录管理后台</h2><p>请使用终端创建的管理员账号。普通书屋账号不能登录这里。</p><label>管理员账号<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void login() }} /></label><button disabled={busy || !username || !password} onClick={() => void login()}>登录</button></section> : <>
      <nav className="admin-nav" aria-label="后台导航"><button className={section === 'overview' ? 'selected' : ''} onClick={() => setSection('overview')}>总览</button><button className={section === 'users' ? 'selected' : ''} onClick={() => setSection('users')}>用户与业务</button><button className={section === 'options' ? 'selected' : ''} onClick={() => setSection('options')}>选项维护</button></nav>
      {section === 'overview' && overview && <><div className="page-head"><p className="eyebrow">运营数据</p><h2>书屋总览</h2><p>最近 30 天注册和借阅趋势，以及图书分类分布。</p></div><div className="metric-grid"><article><span>用户总数</span><strong>{overview.users.total}</strong><small>活跃 {overview.users.active} · 近 30 天新增 {overview.users.new30Days}</small></article><article><span>图书总数</span><strong>{totalBooks}</strong><small>可借 {overview.books.AVAILABLE || 0} · 下架 {overview.books.OFF_SHELF || 0}</small></article><article><span>借阅总数</span><strong>{totalLoans}</strong><small>借出中 {overview.loans.LENT || 0} · 已归还 {overview.loans.RETURNED || 0}</small></article></div><div className="panel-grid"><section className="panel"><h3>最近 30 天趋势</h3><div className="trend-legend"><span>● 新用户</span><span>● 借阅申请</span></div><div className="trend-chart" role="img" aria-label="最近30天新用户和借阅申请柱状图">{overview.trend.map(day => <div className="trend-day" key={day.day} title={`${day.day}：新用户 ${day.users}，借阅 ${day.loans}`}><i style={{ height: `${Math.max(3, day.users / maxTrend * 100)}%` }} /><b style={{ height: `${Math.max(3, day.loans / maxTrend * 100)}%` }} /></div>)}</div><div className="chart-axis"><span>{overview.trend[0]?.day}</span><span>{overview.trend.at(-1)?.day}</span></div></section><section className="panel"><h3>图书分类</h3>{overview.categories.map(row => <div className="distribution" key={row.label}><span>{row.label}</span><div><i style={{ width: `${totalBooks ? row.count / totalBooks * 100 : 0}%` }} /></div><strong>{row.count}</strong></div>)}</section></div></>}
      {section === 'users' && users && <><div className="page-head"><p className="eyebrow">用户资料与业务</p><h2>{users.total} 位用户</h2><p>联系电话默认遮挡，主动查看会记录操作。此处不显示孩子姓名或交接地点。</p></div><div className="table-wrap"><table><thead><tr><th>用户</th><th>注册信息</th><th>联系电话</th><th>业务数据</th></tr></thead><tbody>{users.users.map(user => <tr key={user.id}><td><strong>{user.displayName}</strong><small>@{user.username} · {user.status}</small></td><td>{user.email}<small>注册于 {new Date(user.createdAt).toLocaleDateString('zh-CN')}</small></td><td><span>{revealed[user.id] || user.phoneMasked || '暂未提供'}</span><small>未短信验证</small><button className="ghost" disabled={busy} onClick={() => void reveal(user)}>主动查看</button></td><td>藏书 {user.books} · 借入 {user.borrowed} · 借出 {user.lent}</td></tr>)}</tbody></table></div><div className="pager"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} 页 / 共 {Math.max(1, Math.ceil(users.total / 20))} 页</span><button disabled={page * 20 >= users.total} onClick={() => setPage(page + 1)}>下一页</button></div></>}
      {section === 'options' && options && <><div className="page-head"><p className="eyebrow">书目与档案共用</p><h2>选项维护</h2><p>停用选项不会再供新内容选择，已有图书和孩子档案仍显示原值。</p></div><div className="option-grid">{kinds.map(group => <section className="panel" key={group.kind}><h3>{group.title}</h3><div className="option-list">{options[group.key].map(option => <div className="option-row" key={option.id}><input aria-label={`${group.title}名称`} defaultValue={option.label} key={`${option.id}-${option.label}`} onBlur={event => { const value = event.target.value.trim(); if (value && value !== option.label) void changeOption(option, { label: value }) }} /><input className="order-input" type="number" min="0" max="100000" aria-label="排序" defaultValue={option.sortOrder} key={`${option.id}-${option.sortOrder}`} onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value !== option.sortOrder) void changeOption(option, { sortOrder: value }) }} /><button className={option.active ? 'outline' : ''} disabled={busy} onClick={() => void changeOption(option, { active: !option.active })}>{option.active ? '停用' : '恢复'}</button></div>)}</div><div className="option-add"><input aria-label={`新增${group.title}`} placeholder={`新增${group.title}`} value={newNames[group.key] || ''} onChange={event => setNewNames(value => ({ ...value, [group.key]: event.target.value }))} /><button disabled={busy || !newNames[group.key]?.trim()} onClick={() => void createOption(group.kind, group.key)}>新增</button></div></section>)}</div></>}
    </>}
  </main>
}
export default App
