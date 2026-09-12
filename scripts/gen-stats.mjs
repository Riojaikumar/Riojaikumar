// Renders two self-contained animated SVG cards (stats + languages) from the
// GitHub GraphQL API. Self-hosted on purpose: the shared
// github-readme-stats instance is frequently rate-limited or paused (503),
// which left the profile showing two broken images.
import { writeFileSync, mkdirSync } from 'node:fs'

const LOGIN = process.env.GH_LOGIN
const TOKEN = process.env.GH_TOKEN
if (!LOGIN || !TOKEN) { console.error('GH_LOGIN and GH_TOKEN are required'); process.exit(1) }

// PR and issue counts come from the SEARCH API, not user.pullRequests: the
// workflow runs with secrets.GITHUB_TOKEN, which is repo-scoped, and the user
// connections return 0 under it. Search counts public activity correctly with
// any token. Set a GH_PAT repo secret (read:user) to include private activity.
const QUERY = `query($login:String!){
  user(login:$login){
    followers{totalCount}
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      totalCount
      nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } }
    }
    contributionsCollection{
      totalCommitContributions
      restrictedContributionsCount
      totalRepositoriesWithContributedCommits
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ contributionCount date } }
      }
    }
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
const cal = c.contributionCalendar
const days = cal.weeks.flatMap(w => w.contributionDays)
const counts = days.map(d => d.contributionCount)

const stars = u.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0)
const totalContributions = cal.totalContributions
const activeDays = counts.filter(n => n > 0).length
const peakDay = counts.length ? Math.max(...counts) : 0
const last30 = counts.slice(-30)

// streaks
let currentStreak = 0
for (let i = counts.length - 1; i >= 0; i--) { if (counts[i] > 0) currentStreak++; else break }
let bestStreak = 0, run = 0
for (const n of counts) { run = n > 0 ? run + 1 : 0; if (run > bestStreak) bestStreak = run }

const langTotals = new Map()
for (const r of u.repositories.nodes)
  for (const e of (r.languages?.edges ?? [])) {
    const p = langTotals.get(e.node.name) ?? { size: 0, color: e.node.color || '#7dd3fc' }
    p.size += e.size; langTotals.set(e.node.name, p)
  }
const langs = [...langTotals.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8)
const langSum = langs.reduce((n, [, v]) => n + v.size, 0) || 1

const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n)
const r1 = n => Math.round(n * 10) / 10

// ---------------------------------------------------------------- stats card
const W = 460, H = 250
const CX = 104, CY = 148, R = 52
const CIRC = 2 * Math.PI * R
const pct = Math.min(1, activeDays / Math.max(1, days.length))
const endOffset = r1(CIRC * (1 - pct))

// sparkline geometry
const SX = 186, SW = 250, SY0 = 104, SH = 52
const peak = Math.max(1, ...last30)
const pts = last30.map((v, i) => [
  r1(SX + (i * SW) / Math.max(1, last30.length - 1)),
  r1(SY0 + SH - (v / peak) * SH),
])
const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
const area = `${line} L${pts[pts.length - 1][0]} ${SY0 + SH} L${pts[0][0]} ${SY0 + SH} Z`

const chips = [
  ['CURRENT', `${currentStreak}d`, '#38bdf8'],
  ['BEST', `${bestStreak}d`, '#a78bfa'],
  ['PEAK', String(peakDay), '#34d399'],
]
const chipW = 78, chipGap = 8
const chipsSvg = chips.map(([k, v, col], i) => {
  const x = SX + i * (chipW + chipGap)
  return `    <g>
      <rect x="${x}" y="180" width="${chipW}" height="38" rx="9" fill="#0f172a" stroke="${col}" stroke-opacity=".4"/>
      <text class="s-t" x="${x + chipW / 2}" y="195" text-anchor="middle" font-size="9" fill="#64748b" letter-spacing="1.2">${k}</text>
      <text class="s-t" x="${x + chipW / 2}" y="211" text-anchor="middle" font-size="15" font-weight="700" fill="${col}">${esc(v)}</text>
    </g>`
}).join('\n')

const corner = (x, y, sx, sy) =>
  `<path d="M${x} ${y + sy * 14} L${x} ${y} L${x + sx * 14} ${y}" fill="none" stroke="#38bdf8" stroke-opacity=".5" stroke-width="1.6"/>`

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub contribution telemetry for ${esc(LOGIN)}">
  <defs>
    <linearGradient id="s-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/><stop offset="100%" stop-color="#11162c"/>
    </linearGradient>
    <linearGradient id="s-arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/><stop offset="55%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#34d399"/>
    </linearGradient>
    <linearGradient id="s-spark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity=".55"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="s-scan" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0"/>
      <stop offset="50%" stop-color="#7dd3fc" stop-opacity=".30"/>
      <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0"/>
    </linearGradient>
    <filter id="s-glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="s-grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <path d="M26 0H0V26" fill="none" stroke="#7dd3fc" stroke-opacity=".05"/>
    </pattern>
    <clipPath id="s-clip"><rect width="${W}" height="${H}" rx="14"/></clipPath>
    <style>
      .s-t{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
      @media (prefers-reduced-motion: reduce){ .s-anim{display:none} }
    </style>
  </defs>
  <g clip-path="url(#s-clip)">
    <rect width="${W}" height="${H}" fill="url(#s-bg)"/>
    <rect width="${W}" height="${H}" fill="url(#s-grid)"/>

    <rect class="s-anim" x="0" y="-60" width="${W}" height="60" fill="url(#s-scan)">
      <animate attributeName="y" values="-60;${H}" dur="6s" repeatCount="indefinite"/>
    </rect>

    <text class="s-t" x="24" y="30" font-size="10.5" fill="#64748b" letter-spacing="2.4">CONTRIBUTION TELEMETRY</text>
    <text class="s-t" x="${W - 24}" y="30" font-size="10.5" text-anchor="end" fill="#475569" letter-spacing="1.4">@${esc(LOGIN)}</text>
    <rect x="24" y="40" width="${W - 48}" height="1.4" rx="1" fill="url(#s-arc)">
      <animate attributeName="opacity" values=".45;1;.45" dur="4.5s" repeatCount="indefinite"/>
    </rect>

    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#1e293b" stroke-width="10"/>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="url(#s-arc)" stroke-width="10" stroke-linecap="round"
            filter="url(#s-glow)" transform="rotate(-90 ${CX} ${CY})"
            stroke-dasharray="${r1(CIRC)}" stroke-dashoffset="${endOffset}">
      <animate attributeName="stroke-dashoffset" from="${r1(CIRC)}" to="${endOffset}" dur="1.6s" fill="freeze"/>
    </circle>
    <text class="s-t" x="${CX}" y="${CY + 2}" text-anchor="middle" font-size="30" font-weight="800" fill="#e2e8f0">${fmt(totalContributions)}</text>
    <text class="s-t" x="${CX}" y="${CY + 20}" text-anchor="middle" font-size="8.5" fill="#64748b" letter-spacing="1.6">CONTRIBUTIONS</text>
    <text class="s-t" x="${CX}" y="${CY + R + 26}" text-anchor="middle" font-size="10" fill="#94a3b8">${activeDays} active days</text>

    <text class="s-t" x="${SX}" y="96" font-size="9.5" fill="#64748b" letter-spacing="1.6">LAST 30 DAYS</text>
    <text class="s-t" x="${SX + SW}" y="96" font-size="9.5" text-anchor="end" fill="#475569">peak ${peakDay}</text>
    <path d="${area}" fill="url(#s-spark)"/>
    <path d="${line}" fill="none" stroke="#7dd3fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          pathLength="100" stroke-dasharray="100" stroke-dashoffset="0">
      <animate attributeName="stroke-dashoffset" from="100" to="0" dur="1.9s" fill="freeze"/>
    </path>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.2" fill="#e0f2fe">
      <animate attributeName="r" values="3.2;5;3.2" dur="2.4s" repeatCount="indefinite"/>
    </circle>

${chipsSvg}

    <g>
      ${corner(12, 12, 1, 1)}${corner(W - 12, 12, -1, 1)}
      ${corner(12, H - 12, 1, -1)}${corner(W - 12, H - 12, -1, -1)}
    </g>
    <rect width="${W}" height="${H}" rx="14" fill="none" stroke="#38bdf8" stroke-opacity=".18" stroke-width="1.5"/>
  </g>
</svg>
`

// ---------------------------------------------------------- languages card
// A donut rather than bars: with only a couple of public languages, a bar list
// left most of the card empty next to the telemetry panel.
const LW = 400, LH = 250
const LCX = 108, LCY = 150, LR = 50, LSW = 20
const LCIRC = 2 * Math.PI * LR
let cum = 0
const segs = langs.map(([name, v], i) => {
  const f = v.size / langSum
  const seg = r1(f * LCIRC)
  const off = r1(-cum * LCIRC)
  cum += f
  return `    <circle cx="${LCX}" cy="${LCY}" r="${LR}" fill="none" stroke="${esc(v.color)}" stroke-width="${LSW}"
            transform="rotate(-90 ${LCX} ${LCY})" stroke-dasharray="${seg} ${r1(LCIRC)}" stroke-dashoffset="${off}">
      <animate attributeName="stroke-dasharray" from="0 ${r1(LCIRC)}" to="${seg} ${r1(LCIRC)}" dur="1.1s" begin="${(i * 0.18).toFixed(2)}s" fill="freeze"/>
    </circle>`
}).join('\n')

const legend = langs.map(([name, v], i) => {
  const p = (v.size / langSum) * 100
  const y = 108 + i * 30
  return `    <g>
      <rect x="200" y="${y - 10}" width="11" height="11" rx="3" fill="${esc(v.color)}"/>
      <text class="l-t" x="220" y="${y}" font-size="12.5" fill="#cbd5e1">${esc(name)}</text>
      <text class="l-t" x="${LW - 24}" y="${y}" font-size="12.5" text-anchor="end" fill="#94a3b8">${p.toFixed(1)}%</text>
    </g>`
}).join('\n')

const langsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LW} ${LH}" width="${LW}" height="${LH}" role="img" aria-label="Language mix across public repositories">
  <defs>
    <linearGradient id="l-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/><stop offset="100%" stop-color="#11162c"/>
    </linearGradient>
    <linearGradient id="l-rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#34d399"/>
    </linearGradient>
    <pattern id="l-grid" width="26" height="26" patternUnits="userSpaceOnUse">
      <path d="M26 0H0V26" fill="none" stroke="#7dd3fc" stroke-opacity=".05"/>
    </pattern>
    <clipPath id="l-clip"><rect width="${LW}" height="${LH}" rx="14"/></clipPath>
    <style>.l-t{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}</style>
  </defs>
  <g clip-path="url(#l-clip)">
    <rect width="${LW}" height="${LH}" fill="url(#l-bg)"/>
    <rect width="${LW}" height="${LH}" fill="url(#l-grid)"/>
    <text class="l-t" x="24" y="30" font-size="10.5" fill="#64748b" letter-spacing="2.4">LANGUAGE MIX</text>
    <text class="l-t" x="${LW - 24}" y="30" font-size="9.5" text-anchor="end" fill="#475569" letter-spacing="1.2">PUBLIC REPOS</text>
    <rect x="24" y="40" width="${LW - 48}" height="1.4" rx="1" fill="url(#l-rule)">
      <animate attributeName="opacity" values=".45;1;.45" dur="4.5s" repeatCount="indefinite"/>
    </rect>
    <circle cx="${LCX}" cy="${LCY}" r="${LR}" fill="none" stroke="#1e293b" stroke-width="${LSW}"/>
${segs}
    <text class="l-t" x="${LCX}" y="${LCY - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="#e2e8f0">${langs.length}</text>
    <text class="l-t" x="${LCX}" y="${LCY + 15}" text-anchor="middle" font-size="8.5" fill="#64748b" letter-spacing="1.4">LANGUAGES</text>
    <text class="l-t" x="${LCX}" y="${LCY + LR + 30}" text-anchor="middle" font-size="10" fill="#94a3b8">${u.repositories.totalCount} public repos</text>
    <text class="l-t" x="200" y="82" font-size="9.5" fill="#64748b" letter-spacing="1.4">BY BYTES</text>
${legend}
    <rect width="${LW}" height="${LH}" rx="14" fill="none" stroke="#38bdf8" stroke-opacity=".18" stroke-width="1.5"/>
  </g>
</svg>
`

mkdirSync('dist', { recursive: true })
writeFileSync('dist/stats.svg', statsSvg)
writeFileSync('dist/langs.svg', langsSvg)
console.log(`contributions=${totalContributions} active=${activeDays} streak=${currentStreak}/${bestStreak} peak=${peakDay} repos=${u.repositories.totalCount}`)
console.log(`langs: ${langs.map(([n]) => n).join(', ') || '(none)'}`)
