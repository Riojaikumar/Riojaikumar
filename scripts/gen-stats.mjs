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
// "Contribution telemetry" HUD. Geometry notes so this stays maintainable:
//   gauge   centre (104,130), r=48, a 270 degree arc beginning at 135 degrees.
//           arc length = 2*PI*48*0.75 = 226.19; dashoffset = length * (1 - coverage),
//           and the ATTRIBUTE carries the final value so the gauge is correct
//           even if the animation never runs.
//   bars    30 columns, x from 198 step 8.75, width 6.2, baseline y=214.
const GA_LEN = 226.19
const coverage = Math.min(1, activeDays / Math.max(1, days.length))
const gaugeOffset = r1(GA_LEN * (1 - coverage))
const tipAngle = (135 + coverage * 270) * Math.PI / 180
const tipX = r1(104 + 48 * Math.cos(tipAngle))
const tipY = r1(130 + 48 * Math.sin(tipAngle))
const covPct = (coverage * 100).toFixed(1)

// Histogram scales to the 30-day maximum; peakDay (the yearly best) is shown
// separately in its own tile, so the two must not be conflated.
const peak = Math.max(1, ...last30)
const BAR_X0 = 198, BAR_STEP = 8.75, BAR_W = 6.2, BAR_BASE = 214, BAR_MAX_H = 40
const peakIdx = last30.indexOf(Math.max(...last30))
const bars = last30.map((v, i) => {
  const h = Math.max(2.5, r1((v / Math.max(1, peak)) * BAR_MAX_H))
  const x = r1(BAR_X0 + i * BAR_STEP)
  return `<rect x="${x}" y="${r1(BAR_BASE - h)}" width="${BAR_W}" height="${h}" rx="1.5"/>`
}).join('')
const peakMarkX = r1(BAR_X0 + peakIdx * BAR_STEP + BAR_W / 2)
const peakMarkY = r1(BAR_BASE - Math.max(2.5, (last30[peakIdx] / Math.max(1, peak)) * BAR_MAX_H) - 6)

const tile = (x, y, label, value, unit, colour) => `  <g>
    <rect x="${x}" y="${y}" width="${TILE_W}" height="${TILE_H}" rx="9" fill="#0e1530" stroke="#223058"/>
    <rect x="${x + 12}" y="${y + 12}" width="3" height="18" rx="1.5" fill="${colour}"/>
    <text x="${x + 24}" y="${y + 20}" font-size="10" letter-spacing="0.6" fill="#64748b">${esc(label)}</text>
    <text x="${x + 24}" y="${y + 40}" font-size="19" font-weight="700" fill="${colour}">${esc(value)}<tspan dx="5" font-size="10" font-weight="400" fill="#64748b">${esc(unit)}</tspan></text>
  </g>`
const TILE_W = 128, TILE_H = 52
const tiles = [
  tile(206, 58, 'CURRENT STREAK', currentStreak, 'days', '#38bdf8'),
  tile(344, 58, 'BEST STREAK', bestStreak, 'days', '#a78bfa'),
  tile(206, 120, 'PEAK DAY', peakDay, 'in 24h', '#34d399'),
  tile(344, 120, 'PUBLIC REPOS', u.repositories.totalCount, 'shipped', '#c4b5fd'),
].join('\n')

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 240" width="480" height="240" role="img" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">
<title>Contribution telemetry: ${totalContributions} contributions in the past year, ${activeDays} of ${days.length} days active, current streak ${currentStreak} days, best streak ${bestStreak}, peak day ${peakDay}, ${u.repositories.totalCount} public repositories.</title>
<defs>
<linearGradient id="tpBg" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#11162c"/></linearGradient>
<radialGradient id="tpHalo" cx="0.16" cy="0.05" r="0.8"><stop offset="0" stop-color="#38bdf8" stop-opacity="0.15"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
<pattern id="tpGrid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#151d36" stroke-width="1"/></pattern>
<linearGradient id="tpArcG" gradientUnits="userSpaceOnUse" x1="56" y1="178" x2="152" y2="82"><stop offset="0" stop-color="#34d399"/><stop offset="0.48" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
<linearGradient id="tpBarG" gradientUnits="userSpaceOnUse" x1="0" y1="170" x2="0" y2="214"><stop offset="0" stop-color="#c4b5fd"/><stop offset="0.38" stop-color="#38bdf8"/><stop offset="1" stop-color="#2b6c93"/></linearGradient>
<linearGradient id="tpCovG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#38bdf8"/></linearGradient>
<linearGradient id="tpRuleG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></linearGradient>
<linearGradient id="tpScanG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38bdf8" stop-opacity="0"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0.13"/></linearGradient>
<filter id="tpGlow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="3.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="tpCard"><rect x="0" y="0" width="480" height="240" rx="14"/></clipPath>
<style>
#tpBars{transform-box:fill-box;transform-origin:50% 100%;animation:tp-rise 1.15s cubic-bezier(.22,1,.36,1)}
.tp-scan{animation:tp-sweep 6.5s linear infinite}
.tp-ping{animation:tp-ping 2.8s ease-out infinite}
.tp-blink{animation:tp-blink 2.8s ease-in-out infinite}
@keyframes tp-rise{from{transform:scaleY(.02)}}
@keyframes tp-sweep{0%{transform:translateX(0)}100%{transform:translateX(452px)}}
@keyframes tp-ping{0%{r:3.2;opacity:.6}75%,100%{r:10;opacity:0}}
@keyframes tp-blink{0%,100%{opacity:1}50%{opacity:.2}}
@media (prefers-reduced-motion:reduce){#tpBars,.tp-scan,.tp-ping,.tp-blink{animation:none}}
</style>
</defs>
<g clip-path="url(#tpCard)">
<rect width="480" height="240" fill="url(#tpBg)"/>
<rect width="480" height="240" fill="url(#tpGrid)" opacity="0.85"/>
<rect width="480" height="240" fill="url(#tpHalo)"/>
<g class="tp-scan"><rect x="-2" y="8" width="28" height="224" fill="url(#tpScanG)"/><rect x="25" y="8" width="1.2" height="224" fill="#7dd3fc" opacity="0.2"/></g>
</g>
<rect x="0.75" y="0.75" width="478.5" height="238.5" rx="13.25" fill="none" stroke="#1e2748"/>
<path d="M15 33 L15 21 A6 6 0 0 1 21 15 L33 15" fill="none" stroke="#38bdf8" stroke-opacity="0.32" stroke-width="1.4"/>
<path d="M447 15 L459 15 A6 6 0 0 1 465 21 L465 33" fill="none" stroke="#a78bfa" stroke-opacity="0.32" stroke-width="1.4"/>
<rect x="20.75" y="20.75" width="10.5" height="10.5" rx="3.2" fill="none" stroke="#38bdf8" stroke-width="1.4" opacity="0.75"/>
<circle cx="26" cy="26" r="2.4" fill="#38bdf8" class="tp-blink"/>
<text x="41" y="30" font-size="11" letter-spacing="1.4" fill="#9fb1cd">CONTRIBUTION TELEMETRY</text>
<text x="459" y="30" font-size="10" letter-spacing="1.4" text-anchor="end" fill="#64748b">@${esc(LOGIN)}</text>
<rect x="20" y="42.5" width="440" height="1" fill="#1a2240"/>
<rect x="20" y="42" width="56" height="2" rx="1" fill="url(#tpRuleG)"/>
<rect x="190" y="58" width="1" height="158" fill="#1a2240"/>
<path d="M61.57 172.43 A60 60 0 1 1 146.43 172.43" fill="none" stroke="#2a3556" stroke-width="5" stroke-dasharray="2 26.27"/>
<path d="M70.06 163.94 A48 48 0 1 1 137.94 163.94" fill="none" stroke="#182046" stroke-width="10" stroke-linecap="round"/>
<path d="M70.06 163.94 A48 48 0 1 1 137.94 163.94" fill="none" stroke="url(#tpArcG)" stroke-width="10" stroke-linecap="round" filter="url(#tpGlow)" stroke-dasharray="${GA_LEN}" stroke-dashoffset="${gaugeOffset}">
<animate attributeName="stroke-dashoffset" values="${GA_LEN};${gaugeOffset}" keyTimes="0;1" dur="1.7s" calcMode="spline" keySplines="0.17 0.84 0.26 1" fill="freeze"/>
</path>
<circle cx="${tipX}" cy="${tipY}" r="5.5" fill="none" stroke="#a78bfa" stroke-width="1.3" opacity="0.3" class="tp-ping"/>
<circle cx="${tipX}" cy="${tipY}" r="3.1" fill="#e9e3ff"/>
<text x="104" y="106" font-size="10" letter-spacing="2.2" text-anchor="middle" fill="#64748b">TOTAL</text>
<text x="104" y="134" font-size="30" font-weight="700" letter-spacing="-0.5" text-anchor="middle" fill="#e8eefb">${totalContributions}</text>
<text x="104" y="149" font-size="10" letter-spacing="1.4" text-anchor="middle" fill="#7c8db0">CONTRIBS</text>
<rect x="44" y="186" width="120" height="5" rx="2.5" fill="#182046"/>
<rect x="44" y="186" width="${r1(120 * coverage)}" height="5" rx="2.5" fill="url(#tpCovG)">
<animate attributeName="width" values="0;${r1(120 * coverage)}" keyTimes="0;1" dur="1.5s" calcMode="spline" keySplines="0.17 0.84 0.26 1" fill="freeze"/>
</rect>
<text x="104" y="209" font-size="10" letter-spacing="0.7" text-anchor="middle" fill="#64748b"><tspan fill="#34d399" font-weight="700">${activeDays}</tspan>/${days.length} ACTIVE DAYS</text>
<text x="104" y="227" font-size="10" letter-spacing="0.7" text-anchor="middle" fill="#64748b"><tspan fill="#38bdf8" font-weight="700">${covPct}%</tspan> YEAR COVERAGE</text>
${tiles}
<text x="206" y="190" font-size="10" letter-spacing="1.2" fill="#64748b">LAST 30 DAYS</text>
<text x="459" y="190" font-size="10" letter-spacing="1.2" text-anchor="end" fill="#64748b">MAX <tspan fill="#34d399" font-weight="700">${peak}</tspan></text>
<g id="tpBars" fill="url(#tpBarG)">${bars}</g>
<circle cx="${peakMarkX}" cy="${peakMarkY}" r="2.6" fill="#34d399"/>
<text x="206" y="230" font-size="9.5" letter-spacing="0.8" fill="#475569">30D AGO</text>
<text x="459" y="230" font-size="9.5" letter-spacing="0.8" text-anchor="end" fill="#475569">TODAY</text>
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
