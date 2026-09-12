// Renders two self-contained animated SVG cards (stats + languages) from the
// GitHub GraphQL API. Self-hosted on purpose: the shared
// github-readme-stats instance is frequently rate-limited or paused (503),
// which left the profile showing two broken images.
import { writeFileSync, mkdirSync } from 'node:fs'

const LOGIN = process.env.GH_LOGIN
const TOKEN = process.env.GH_TOKEN
if (!LOGIN || !TOKEN) { console.error('GH_LOGIN and GH_TOKEN are required'); process.exit(1) }

const QUERY = `query($login:String!){
  user(login:$login){
    followers{totalCount}
    repositories(first:100, ownerAffiliations:OWNER, isFork:false){
      totalCount
      nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } }
    }
    contributionsCollection{
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
    }
    pullRequests{totalCount}
    issues{totalCount}
  }
}`

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { authorization: `bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
})
if (!res.ok) { console.error('GitHub API', res.status, await res.text()); process.exit(1) }
const { data, errors } = await res.json()
if (errors) { console.error(JSON.stringify(errors)); process.exit(1) }

const u = data.user
const c = u.contributionsCollection
const stars = u.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0)
const commits = c.totalCommitContributions + c.restrictedContributionsCount

const langTotals = new Map()
for (const r of u.repositories.nodes)
  for (const e of (r.languages?.edges ?? [])) {
    const p = langTotals.get(e.node.name) ?? { size: 0, color: e.node.color || '#7dd3fc' }
    p.size += e.size; langTotals.set(e.node.name, p)
  }
const langs = [...langTotals.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8)
const langSum = langs.reduce((n, [, v]) => n + v.size, 0) || 1

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n)

const CHROME = `
  <defs>
    <linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/><stop offset="100%" stop-color="#11162c"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#34d399"/>
    </linearGradient>
    <style>
      .t{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
      .ttl{font-size:15px;fill:#a78bfa;letter-spacing:1.4px}
      .k{font-size:12.5px;fill:#94a3b8}
      .v{font-size:16px;fill:#e2e8f0;font-weight:700}
      /* Rows are visible by default. An opacity-0 entrance animation made the
         whole card render blank whenever the animation did not run. Motion is
         an enhancement here, never a precondition for the content showing. */
      .dot{transform-origin:center}
    </style>
  </defs>`

const card = (w, h, title, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
${CHROME}
  <rect width="${w}" height="${h}" rx="14" fill="url(#cbg)" stroke="#38bdf8" stroke-opacity=".18"/>
  <text class="t ttl" x="22" y="34">${esc(title)}</text>
  <rect x="22" y="44" width="${w - 44}" height="1.5" rx="1" fill="url(#accent)">
    <animate attributeName="opacity" values=".4;1;.4" dur="4s" repeatCount="indefinite"/>
  </rect>
${inner}
</svg>\n`

// ---- stats card ----
const rows = [
  ['Total Commits', fmt(commits)],
  ['Pull Requests', fmt(u.pullRequests.totalCount)],
  ['Issues', fmt(u.issues.totalCount)],
  ['Public Repos', fmt(u.repositories.totalCount)],
  ['Stars Earned', fmt(stars)],
  ['Followers', fmt(u.followers.totalCount)],
]
const statsInner = rows.map(([k, v], i) => {
  const y = 76 + i * 30
  return `  <g>
    <circle class="dot" cx="30" cy="${y - 5}" r="3" fill="url(#accent)">
      <animate attributeName="r" values="3;4.2;3" dur="3s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/>
    </circle>
    <text class="t k" x="46" y="${y}">${esc(k)}</text>
    <text class="t v" x="378" y="${y}" text-anchor="end">${esc(v)}</text>
  </g>`
}).join('\n')

// ---- languages card ----
let acc = 0
const langInner = langs.map(([name, v], i) => {
  const pct = (v.size / langSum) * 100
  const y = 74 + i * 26
  const barW = Math.max(4, (pct / 100) * 236)
  acc += pct
  return `  <g>
    <text class="t k" x="22" y="${y}">${esc(name)}</text>
    <rect x="120" y="${y - 10}" width="236" height="8" rx="4" fill="#1e293b"/>
    <rect x="120" y="${y - 10}" width="${barW.toFixed(1)}" height="8" rx="4" fill="${esc(v.color)}">
      <animate attributeName="width" from="0" to="${barW.toFixed(1)}" dur="1.1s" begin="${(i * 0.1).toFixed(2)}s" fill="freeze"/>
    </rect>
    <text class="t k" x="378" y="${y}" text-anchor="end">${pct.toFixed(1)}%</text>
  </g>`
}).join('\n')

mkdirSync('dist', { recursive: true })
writeFileSync('dist/stats.svg', card(400, 76 + rows.length * 30, 'GITHUB STATS', statsInner))
writeFileSync('dist/langs.svg', card(400, 74 + langs.length * 26, 'MOST USED LANGUAGES', langInner))
console.log(`stats: commits=${commits} prs=${u.pullRequests.totalCount} repos=${u.repositories.totalCount} stars=${stars}`)
console.log(`langs: ${langs.map(([n]) => n).join(', ')}`)
