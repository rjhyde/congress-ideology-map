'use strict';
/* Congress Ideology Map v2 — full feature rebuild
   Score-mapped X layout · adaptive weights · opacity=consistency · power index · search · history */

// ── State ────────────────────────────────────────────────────────────────────
let ALL_MEMBERS = [];
let currentChamber = 'house';
let currentScore = 'enhanced';
let selectedMember = null;
let searchQuery = '';
let SPOTLIGHTS = {};       // loaded from /api/spotlights
let activeSpotlight = null; // key of hovered spotlight group

// ── Color ────────────────────────────────────────────────────────────────────
function ideologyColor(score) {
  const t = Math.max(0, Math.min(1, (score + 1) / 2));
  if (t < 0.5) return d3.interpolateRgb('#1a56db', '#9333ea')(t * 2);
  return d3.interpolateRgb('#9333ea', '#dc2626')((t - 0.5) * 2);
}
function consistencyColor(c) {
  if (c >= 0.75) return '#3fb950';
  if (c >= 0.5)  return '#d29922';
  return '#f85149';
}

// ── Score accessor ────────────────────────────────────────────────────────────
function getScore(m) {
  const src = m.enhanced_sources || {};
  if (currentScore === 'nominate')  return m.nominate_dim1;
  if (currentScore === 'govtrack')  return m.govtrack_ideology !== null ? (m.govtrack_ideology - 0.5) * 2 : m.nominate_dim1;
  if (currentScore === 'heritage')  return src.heritage !== undefined ? src.heritage : m.nominate_dim1;
  if (currentScore === 'lcv')       return src.lcv !== undefined ? src.lcv : m.nominate_dim1;
  if (currentScore === 'fec') {
    if (m.fec_receipts == null) return m.nominate_dim1;
    // FEC: normalize receipts to ideology proxy — high receipts for Rep = conservative, for Dem = liberal
    const sign = m.party_code === '200' ? 1 : -1;
    return Math.min(1, Math.max(-1, sign * Math.log10(Math.max(1, m.fec_receipts)) / 7));
  }
  return m.enhanced_score !== undefined ? m.enhanced_score : m.composite_score;
}

// ── Score-mapped column layout ────────────────────────────────────────────────
function scoreColumnLayout(members, W) {
  if (!members.length) return { positions: [], xScale: x=>x, dotR: 5, baseY: 400, minY: 0 };

  const scores = members.map(m => getScore(m));
  const minS = Math.min(...scores), maxS = Math.max(...scores);
  const pad = Math.max(0.04, (maxS - minS) * 0.04);
  const domainMin = minS - pad, domainMax = maxS + pad;

  const mL = 44, mR = 44;
  const chartW = W - mL - mR;
  const halfW  = chartW / 2;

  const dotR   = members.length > 430 ? 3.2 : members.length > 200 ? 4.0 : 5.5;
  const spacing = dotR * 1.6 + 3.5;

  const xScale = s => mL + ((s - domainMin) / (domainMax - domainMin)) * chartW;

  // ── Fixed-height layout ───────────────────────────────────────────────────
  // Two-pass: compute arcR and arcCy so content fills the container tightly.
  const containerH = document.getElementById('chart-container').clientHeight || 600;
  const topPad     = 20;   // above topmost dot
  const botLabels  = 60;   // axis labels + power bar + percentage label below arc edge

  const arcCx = W / 2;

  // Pass 1: bucket members to find max column size
  const _tmp = new Map();
  for (const m of members) {
    const bx = Math.round(xScale(getScore(m)) / spacing) * spacing;
    _tmp.set(bx, (_tmp.get(bx) || 0) + 1);
  }
  const maxDots = Math.max(..._tmp.values());

  // Available height for dots + arc rise combined
  const availH = containerH - topPad - botLabels;

  // The visible height used = maxDots*spacing (column) + desiredRise (arc curve)
  // We want: maxDots*spacing + desiredRise = availH
  // Choose desiredRise as 20% of availH, columns get the rest
  const desiredRise  = availH * 0.13;
  const colAreaH     = availH - desiredRise; // height available for columns above arc edge

  // arcR from rise formula
  const arcR = (halfW * halfW + desiredRise * desiredRise) / (2 * desiredRise);

  // arcEdgeY = Y of arc surface at the chart edges (lowest point of arc)
  // arcEdgeY = arcCy - sqrt(arcR² - halfW²)
  const arcEdgeOffset = Math.sqrt(Math.max(0, arcR * arcR - halfW * halfW));

  // arcCy: tallest column sits at apex (arcCy - arcR), so:
  // arcApex - (maxDots-1)*spacing - dotR = topPad
  // arcCy - arcR - (maxDots-1)*spacing - dotR = topPad
  // arcCy = topPad + arcR + (maxDots-1)*spacing + dotR
  const arcCy = topPad + arcR + (maxDots - 1) * spacing + dotR;

  function arcBaseY(x) {
    const dx = x - arcCx;
    const r2 = arcR * arcR - dx * dx;
    return r2 >= 0 ? arcCy - Math.sqrt(r2) : arcCy;
  }

  // Bucket members
  const buckets = new Map();
  const sorted = [...members].sort((a, b) => getScore(a) - getScore(b));
  for (const m of sorted) {
    const px = xScale(getScore(m));
    const bx = Math.round(px / spacing) * spacing;
    if (!buckets.has(bx)) buckets.set(bx, []);
    buckets.get(bx).push(m);
  }
  for (const [, group] of buckets) {
    group.sort((a, b) => (b.power_index || 0) - (a.power_index || 0));
  }

  // Place dots — stack upward from arc base
  const positions = [];
  for (const [bx, group] of buckets) {
    const base = arcBaseY(bx);
    group.forEach((m, i) => {
      positions.push({ member: m, x: bx, y: base - i * spacing });
    });
  }

  // Vertical regions anchored to arc edge (lowest visible arc point at chart sides)
  const arcEdgeY   = arcCy - arcEdgeOffset;
  const axisLabelY = arcEdgeY + dotR + 10;
  const pbarY      = axisLabelY + 20;
  const baseY      = pbarY + 12 + 28 + 16; // bar + pct label + padding

  return { positions, xScale, domainMin, domainMax, dotR, baseY, minY: 0, spacing, pbarY, axisLabelY };
}

// ── Render chart ──────────────────────────────────────────────────────────────
function renderChart() {
  const container = document.getElementById('chart-container');
  const W = container.clientWidth || 800;

  const members = getVisibleMembers();
  if (!members.length) return;

  const layout = scoreColumnLayout(members, W);
  const { positions, xScale, domainMin, domainMax, dotR, baseY, minY, pbarY, axisLabelY } = layout;
  const svg = d3.select('#chart')
    .attr('viewBox', `0 0 ${W} ${baseY}`)
    .style('height', baseY + 'px');
  svg.selectAll('*').remove();

  // Center line
  const cx = xScale(0);
  svg.append('line')
    .attr('x1', cx).attr('y1', 4)
    .attr('x2', cx).attr('y2', axisLabelY - 6)
    .attr('stroke', '#21262d').attr('stroke-width', 1).attr('stroke-dasharray', '4,3');

  // Axis labels — positioned at axisLabelY, inside viewBox
  svg.append('text').attr('x', xScale(domainMin) + 4).attr('y', axisLabelY)
    .attr('font-size', 11).attr('fill', '#4493f8').attr('text-anchor', 'start').text('← Liberal');
  svg.append('text').attr('x', xScale(domainMax) - 4).attr('y', axisLabelY)
    .attr('font-size', 11).attr('fill', '#f85149').attr('text-anchor', 'end').text('Conservative →');
  svg.append('text').attr('x', cx).attr('y', axisLabelY)
    .attr('font-size', 10).attr('fill', '#6e7681').attr('text-anchor', 'middle').text('0');

  // Power scale
  const maxPower = d3.max(members, m => m.power_index || 0) || 1;
  const powerScale = d3.scaleSqrt().domain([0, maxPower]).range([dotR * 0.35, dotR * 2.0]);

  const tooltip = document.getElementById('tooltip');

  // Seats
  svg.selectAll('circle.seat')
    .data(positions)
    .join('circle')
    .attr('class', 'seat')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', d => powerScale(d.member.power_index || 0))
    .attr('fill', d => ideologyColor(getScore(d.member)))
    .attr('opacity', d => {
      if (d.member.is_delegate) return 0.45;
      // Spotlight mode: dim non-members, brighten members
      if (activeSpotlight) {
        const group = SPOTLIGHTS[activeSpotlight];
        const inGroup = group && group.members.includes(d.member.bioguide_id);
        return inGroup ? 1.0 : 0.35;
      }
      if (searchQuery && !matchesSearch(d.member)) return 0.08;
      return d.member.opacity !== undefined ? d.member.opacity : 0.85;
    })
    .attr('stroke', d => {
      if (d.member === selectedMember) return '#f0f6fc';
      const pc = d.member.party_code;
      if (pc === '100') return '#4493f8';        // Democrat — blue
      if (pc === '200') return '#f85149';        // Republican — red
      return '#a371f7';                          // Independent — purple
    })
    .attr('stroke-width', d => d.member === selectedMember ? 2.5 : 1.2)
    .attr('stroke-dasharray', d => d.member.is_delegate ? '3,2' : 'none')
    .style('cursor', 'pointer')
    .on('mouseover', (event, d) => showTooltip(event, d.member))
    .on('mousemove', (event) => {
      tooltip.style.left = (event.clientX + 14) + 'px';
      tooltip.style.top  = (event.clientY - 10) + 'px';
    })
    .on('mouseout', () => { tooltip.style.display = 'none'; })
    .on('click', (event, d) => {
      event.stopPropagation();
      selectedMember = d.member;
      renderChart();
      showMemberCard(d.member);
    });

  // Spotlight rings — draw a halo around all members in the active group
  if (activeSpotlight) {
    const group = SPOTLIGHTS[activeSpotlight];
    if (group) {
      const groupSet = new Set(group.members);
      positions.filter(p => groupSet.has(p.member.bioguide_id)).forEach(pos => {
        const r = powerScale(pos.member.power_index || 0);
        svg.append('circle')
          .attr('cx', pos.x).attr('cy', pos.y)
          .attr('r', r + 3)
          .attr('fill', 'none')
          .attr('stroke', group.color)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.9)
          .style('pointer-events', 'none');
      });
    }
  }

  // Selection rings
  if (selectedMember) {
    const pos = positions.find(p => p.member === selectedMember);
    if (pos) {
      const r = powerScale(selectedMember.power_index || 0);
      svg.append('circle').attr('cx', pos.x).attr('cy', pos.y)
        .attr('r', r + 5).attr('fill', 'none')
        .attr('stroke', '#f0f6fc').attr('stroke-width', 1.5)
        .attr('opacity', 0.6).style('pointer-events','none');
      svg.append('circle').attr('cx', pos.x).attr('cy', pos.y)
        .attr('r', r + 9).attr('fill', 'none')
        .attr('stroke', '#f0f6fc').attr('stroke-width', 0.5)
        .attr('opacity', 0.25).style('pointer-events','none');
    }
  }

  // ── Power bar (SVG, just below arc base) ─────────────────────────────────
  const barW  = W * 0.7;
  const barX  = (W - barW) / 2;
  const barH  = 12;
  const barY  = pbarY + 22;

  const dems    = members.filter(m => m.party_code === '100');
  const reps    = members.filter(m => m.party_code === '200');
  const demPow  = dems.reduce((s, m) => s + (m.power_index || 0), 0);
  const repPow  = reps.reduce((s, m) => s + (m.power_index || 0), 0);
  const total   = demPow + repPow || 1;
  const demPct  = demPow / total;
  const repPct  = repPow / total;

  // Background track
  svg.append('rect')
    .attr('x', barX).attr('y', barY)
    .attr('width', barW).attr('height', barH)
    .attr('rx', 6).attr('fill', '#21262d').attr('stroke', '#30363d').attr('stroke-width', 0.5);

  // Dem fill (left)
  svg.append('rect')
    .attr('x', barX).attr('y', barY)
    .attr('width', barW * demPct).attr('height', barH)
    .attr('rx', 6).attr('fill', 'url(#grad-dem)');

  // Rep fill (right)
  svg.append('rect')
    .attr('x', barX + barW * (1 - repPct)).attr('y', barY)
    .attr('width', barW * repPct).attr('height', barH)
    .attr('rx', 6).attr('fill', 'url(#grad-rep)');

  // Center tick
  svg.append('line')
    .attr('x1', barX + barW / 2).attr('y1', barY - 1)
    .attr('x2', barX + barW / 2).attr('y2', barY + barH + 1)
    .attr('stroke', '#30363d').attr('stroke-width', 1);

  // Gradients (define once)
  const defs = svg.append('defs');
  const gd = defs.append('linearGradient').attr('id', 'grad-dem').attr('x1','0%').attr('x2','100%');
  gd.append('stop').attr('offset','0%').attr('stop-color','#1a56db');
  gd.append('stop').attr('offset','100%').attr('stop-color','#4493f8');
  const gr = defs.append('linearGradient').attr('id', 'grad-rep').attr('x1','0%').attr('x2','100%');
  gr.append('stop').attr('offset','0%').attr('stop-color','#f85149');
  gr.append('stop').attr('offset','100%').attr('stop-color','#dc2626');

  // Labels
  svg.append('text').attr('x', barX - 4).attr('y', barY + barH / 2 + 4)
    .attr('font-size', 10).attr('fill', '#4493f8').attr('text-anchor', 'end')
    .attr('font-weight', '600').text('← Liberal Power');
  svg.append('text').attr('x', barX + barW + 4).attr('y', barY + barH / 2 + 4)
    .attr('font-size', 10).attr('fill', '#f85149').attr('text-anchor', 'start')
    .attr('font-weight', '600').text('Conservative Power →');
  svg.append('text').attr('x', W / 2).attr('y', barY + barH + 14)
    .attr('font-size', 10).attr('fill', '#6e7681').attr('text-anchor', 'middle')
    .text(`Dem ${Math.round(demPct*100)}% · Rep ${Math.round(repPct*100)}% power`);
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function showTooltip(event, m) {
  const tooltip = document.getElementById('tooltip');
  const src = m.enhanced_sources || {};
  const wts = m.effective_weights || {};
  const score = getScore(m);

  const heritageDisplay = src.heritage !== undefined
    ? `${Math.round((src.heritage + 1) / 2 * 100)}% conservative` : null;
  const lcvDisplay = src.lcv !== undefined
    ? `${Math.round((1 - src.lcv) / 2 * 100)}% pro-env` : null;

  tooltip.innerHTML = `
    <div class="tt-name">${m.display_name || formatName(m.name)}</div>
    <div class="tt-meta">${m.party} · ${m.state}${m.chamber==='House'?' Dist.'+m.district:''} · ${m.chamber}</div>
    <div class="tt-row"><span class="tt-key">Score</span><span class="tt-val">${score.toFixed(3)}</span></div>
    <div class="tt-row"><span class="tt-key">Power</span><span class="tt-val">${(m.power_index||0).toFixed(1)}${m.power_role?' · '+m.power_role:''}</span></div>
    <div class="tt-row"><span class="tt-key">Consistency</span><span class="tt-val">${Math.round((m.consistency_score||0.5)*100)}%</span></div>
    ${heritageDisplay ? `<div class="tt-row"><span class="tt-key">Heritage</span><span class="tt-val">${heritageDisplay}</span></div>` : ''}
    ${lcvDisplay ? `<div class="tt-row"><span class="tt-key">LCV</span><span class="tt-val">${lcvDisplay}</span></div>` : ''}
    <div class="tt-weights">DW=${Math.round((wts.dw_nominate||0)*100)}% GT=${Math.round((wts.govtrack||0)*100)}% Her=${Math.round((wts.heritage||0)*100)}% LCV=${Math.round((wts.lcv||0)*100)}% FEC=${Math.round((wts.fec||0)*100)}%</div>
  `;
  tooltip.style.display = 'block';
  tooltip.style.left = (event.clientX + 14) + 'px';
  tooltip.style.top  = (event.clientY - 10) + 'px';
}

// ── Member card ───────────────────────────────────────────────────────────────
function formatName(bioname) {
  if (!bioname) return '';
  const parts = bioname.split(',');
  if (parts.length >= 2) {
    const last = parts[0].trim();
    const first = parts[1].trim().split(' ')[0];
    return first.charAt(0).toUpperCase()+first.slice(1).toLowerCase()+' '+last.charAt(0).toUpperCase()+last.slice(1).toLowerCase();
  }
  return bioname;
}

function scorePosBar(score) {
  const pct = ((score + 1) / 2) * 100;
  const leftW = Math.min(50, pct);
  const rightW = Math.max(0, pct - 50);
  return `
    <div class="score-pos-wrap">
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#6e7681;margin-bottom:3px">
        <span>Liberal −1.0</span><span>0</span><span>+1.0 Conservative</span>
      </div>
      <div class="score-pos-track">
        ${pct < 50 ? `<div class="score-pos-fill-l" style="left:${pct}%;width:${50-pct}%"></div>` : ''}
        ${pct > 50 ? `<div class="score-pos-fill-r" style="right:${100-pct}%;width:${pct-50}%"></div>` : ''}
        <div class="score-pos-marker" style="left:${pct}%"></div>
      </div>
    </div>`;
}

function showMemberCard(m) {
  const name = m.display_name || formatName(m.name);
  const src  = m.enhanced_sources || {};
  const wts  = m.effective_weights || {};
  const score = getScore(m);
  const consistency = m.consistency_score || 0.5;

  const srcItems = [
    ['DW-NOMINATE', src.dw_nominate, wts.dw_nominate, '(career avg)'],
    ['GovTrack',    src.govtrack,    wts.govtrack,    ''],
    ['Heritage',    src.heritage !== undefined ? `${Math.round((src.heritage+1)/2*100)}%` : null, wts.heritage, 'conservative'],
    ['LCV',         src.lcv !== undefined ? `${Math.round((1-src.lcv)/2*100)}%` : null, wts.lcv, 'pro-env'],
    ['FEC',         m.fec_receipts ? `$${(m.fec_receipts/1e6).toFixed(1)}M` : null, wts.fec, 'raised'],
  ].filter(([,v]) => v !== null && v !== undefined);

  const cardHTML = `
    <div class="member-card">
      <div class="mc-name">${name}</div>
      <div class="mc-meta">${m.party} · ${m.state}${m.chamber==='House'?' District '+m.district:''} · ${m.chamber}</div>
      ${m.power_role ? `<div class="mc-role">🏛 ${m.power_role}</div>` : ''}
      ${scorePosBar(score)}
      <div class="source-grid">
        ${srcItems.map(([label, val, wt, suffix]) => `
          <div class="src-item">
            <div class="src-label">${label}</div>
            <div class="src-val">${typeof val === 'number' ? val.toFixed(3) : val}</div>
            <div class="src-weight">${Math.round((wt||0)*100)}% weight ${suffix}</div>
          </div>`).join('')}
      </div>
      <div class="consistency-row">
        <span class="consistency-label">Consistency</span>
        <div class="consistency-bar-track">
          <div class="consistency-bar-fill" style="width:${Math.round(consistency*100)}%;background:${consistencyColor(consistency)}"></div>
        </div>
        <span class="consistency-label">${Math.round(consistency*100)}%</span>
      </div>
      <div style="margin-top:8px;display:flex;justify-content:space-between;font-size:11px;color:#6e7681">
        <span>Power: <strong style="color:#e6edf3">${(m.power_index||0).toFixed(1)}</strong></span>
        <span>Sources: <strong style="color:#e6edf3">${m.n_sources||1}/5</strong></span>
        <span>Votes: <strong style="color:#e6edf3">${(m.nominate_votes||0).toLocaleString()}</strong></span>
      </div>
      <button class="history-btn" onclick="loadHistory('${m.bioguide_id}')">📈 View History</button>
    </div>`;

  document.getElementById('member-detail-section').innerHTML = '<h3>Member Detail</h3>' + cardHTML;
  document.getElementById('history-section').style.display = 'none';

  // Mobile card
  const mob = document.getElementById('mobile-member-card');
  if (mob) {
    mob.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong style="font-size:13px">${name}</strong>
      <button onclick="document.getElementById('mobile-member-card').innerHTML=''" style="background:none;border:none;color:#8b949e;font-size:18px;cursor:pointer">×</button>
    </div>` + cardHTML;
  }
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory(bioguide_id) {
  const section = document.getElementById('history-section');
  section.style.display = 'block';
  section.innerHTML = '<h3>History</h3><p style="font-size:12px;color:#6e7681">Loading…</p>';
  try {
    const res = await fetch(`/api/history/${bioguide_id}`);
    const history = await res.json();
    if (!history || !history.length) {
      section.innerHTML = '<h3>History</h3><p style="font-size:12px;color:#6e7681">No historical data available.</p>';
      return;
    }
    renderHistoryPanel(history, section);
  } catch(e) {
    section.innerHTML = '<h3>History</h3><p style="font-size:12px;color:#f85149">Error loading history.</p>';
  }
}

function renderHistoryPanel(history, container) {
  const scores = history.map(h => h.nokken_poole !== undefined && h.nokken_poole !== null ? h.nokken_poole : h.nominate_dim1);
  const careerAvg = history[0].nominate_dim1;
  const allS = [...scores, careerAvg].filter(v => v != null);
  const absMax = Math.max(...allS.map(Math.abs), 0.1);
  const axisMax = Math.min(1.0, absMax * 1.2);

  const first = scores[0], last = scores[scores.length - 1];
  const drift = last - first;
  const driftDir = drift > 0.05 ? 'more conservative' : drift < -0.05 ? 'more liberal' : 'stable';

  const W = 230, H = 150;
  const pad = { t:12, r:10, b:18, l:38 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;

  const xScale = s => pad.l + ((s + axisMax) / (2 * axisMax)) * iW;
  const yScale = i => pad.t + (i / (history.length - 1 || 1)) * iH;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.setAttribute('style', 'display:block;margin:0 auto');

  // Center line
  const zl = document.createElementNS(ns, 'line');
  zl.setAttribute('x1', xScale(0)); zl.setAttribute('y1', pad.t);
  zl.setAttribute('x2', xScale(0)); zl.setAttribute('y2', pad.t + iH);
  zl.setAttribute('stroke', '#30363d'); zl.setAttribute('stroke-width', 1.5);
  svg.appendChild(zl);
  const zt = document.createElementNS(ns, 'text');
  zt.setAttribute('x', xScale(0)); zt.setAttribute('y', H - 3);
  zt.setAttribute('font-size', 8); zt.setAttribute('fill', '#6e7681'); zt.setAttribute('text-anchor', 'middle');
  zt.textContent = '0'; svg.appendChild(zt);

  // Career avg (orange dashed)
  const cl = document.createElementNS(ns, 'line');
  cl.setAttribute('x1', xScale(careerAvg)); cl.setAttribute('y1', pad.t);
  cl.setAttribute('x2', xScale(careerAvg)); cl.setAttribute('y2', pad.t + iH);
  cl.setAttribute('stroke', '#f97316'); cl.setAttribute('stroke-width', 1); cl.setAttribute('stroke-dasharray', '3,3');
  svg.appendChild(cl);
  const ct = document.createElementNS(ns, 'text');
  ct.setAttribute('x', xScale(careerAvg)); ct.setAttribute('y', H - 3);
  ct.setAttribute('font-size', 8); ct.setAttribute('fill', '#f97316'); ct.setAttribute('text-anchor', 'middle');
  ct.textContent = 'avg'; svg.appendChild(ct);

  // Session path
  const pathD = scores.map((s, i) => `${i===0?'M':'L'}${xScale(s)},${yScale(i)}`).join(' ');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathD); path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#58a6ff'); path.setAttribute('stroke-width', 1.5);
  svg.appendChild(path);

  // Dots
  scores.forEach((s, i) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', xScale(s)); c.setAttribute('cy', yScale(i));
    c.setAttribute('r', 3); c.setAttribute('fill', ideologyColor(s));
    c.setAttribute('stroke', '#0d1117'); c.setAttribute('stroke-width', 1);
    svg.appendChild(c);
  });

  // Y axis labels
  [[history[0].congress, pad.t + 4], [history[history.length-1].congress, pad.t + iH + 3]].forEach(([label, y]) => {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', pad.l - 3); t.setAttribute('y', y);
    t.setAttribute('font-size', 8); t.setAttribute('fill', '#6e7681'); t.setAttribute('text-anchor', 'end');
    t.textContent = label + ''; svg.appendChild(t);
  });

  // X axis labels
  [['Lib', pad.l], ['Con', pad.l + iW]].forEach(([label, x]) => {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x); t.setAttribute('y', H - 3);
    t.setAttribute('font-size', 8); t.setAttribute('fill', '#6e7681'); t.setAttribute('text-anchor', 'middle');
    t.textContent = label; svg.appendChild(t);
  });

  container.innerHTML = `<h3>Career History — ${history.length} Congresses</h3>
    <div class="history-panel"></div>`;
  container.querySelector('.history-panel').appendChild(svg);

  const meta = document.createElement('div');
  meta.className = 'h-meta';
  meta.innerHTML = `First: <strong>${first.toFixed(3)}</strong> (${history[0].congress}th) &nbsp;
    Current: <strong>${last.toFixed(3)}</strong> (${history[history.length-1].congress}th)<br>
    Drift: <strong>${drift>0?'+':''}${drift.toFixed(3)}</strong> — ${driftDir}<br>
    <span style="color:#4493f8">●</span> Session score &nbsp;
    <span style="color:#30363d;font-weight:bold">│</span> Center &nbsp;
    <span style="color:#f97316">- -</span> Career avg`;
  container.querySelector('.history-panel').appendChild(meta);
}

// Power bar is rendered in SVG — no HTML fallback needed

// ── Stats bar ─────────────────────────────────────────────────────────────────
function updateStats(members) {
  const dems = members.filter(m => m.party_code === '100');
  const reps = members.filter(m => m.party_code === '200');
  const avg = arr => arr.length ? (arr.reduce((s,m) => s + getScore(m), 0) / arr.length).toFixed(3) : '—';
  const avgSrc = members.length ? (members.reduce((s,m) => s + (m.n_sources||1), 0) / members.length).toFixed(1) : '—';
  document.getElementById('st-total').textContent = members.length;
  document.getElementById('st-dem').textContent   = dems.length;
  document.getElementById('st-rep').textContent   = reps.length;
  document.getElementById('st-avg-dem').textContent = avg(dems);
  document.getElementById('st-avg-rep').textContent = avg(reps);
  document.getElementById('st-sources').textContent = avgSrc;
  document.getElementById('chamber-sub').textContent =
    `${members.length} seats · left = most liberal, right = most conservative`;
}

// ── Member roster ────────────────────────────────────────────────────────────
let _rosterQuery = '';

function renderMemberList() {
  const members = getVisibleMembers();
  const sorted = [...members].sort((a, b) => getScore(a) - getScore(b));
  _renderRoster(sorted, _rosterQuery);
}

function filterRoster(query) {
  _rosterQuery = query.trim().toLowerCase();
  const members = getVisibleMembers();
  const sorted = [...members].sort((a, b) => getScore(a) - getScore(b));
  _renderRoster(sorted, _rosterQuery);
}

function _renderRoster(sorted, query) {
  const filtered = query
    ? sorted.filter(m => {
        const name = (m.display_name || m.name || '').toLowerCase();
        return name.includes(query) || (m.state || '').toLowerCase().includes(query);
      })
    : sorted;

  const roster = document.getElementById('member-roster');
  if (!roster) return;

  roster.innerHTML = filtered.map(m => {
    const score = getScore(m);
    const color = ideologyColor(score);
    const name = m.display_name || formatName(m.name);
    const isSelected = m === selectedMember;
    return `<div class="roster-item${isSelected ? ' selected' : ''}" onclick="selectFromList('${m.bioguide_id}')">
      <div class="roster-swatch" style="background:${color};opacity:${m.opacity || 0.85}"></div>
      <span class="roster-name">${name}</span>
      <span class="roster-meta">${m.state}</span>
      <span class="roster-score">${score.toFixed(2)}</span>
    </div>`;
  }).join('');
}

function selectFromList(bg) {
  const m = ALL_MEMBERS.find(x => x.bioguide_id === bg);
  if (!m) return;
  selectedMember = m;
  renderChart();
  showMemberCard(m);
  // Re-render roster so selected state updates
  renderMemberList();
  // Scroll selected item into view
  const el = document.querySelector('.roster-item.selected');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// ── Search ────────────────────────────────────────────────────────────────────
function matchesSearch(m) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  const name = (m.display_name || m.name || '').toLowerCase();
  return name.includes(q) || (m.state||'').toLowerCase().includes(q) ||
         (m.party||'').toLowerCase().includes(q) || (m.gt_description||'').toLowerCase().includes(q);
}

function onSearch(val) {
  searchQuery = val.trim();
  renderChart();
}

// ── Chamber / score switching ─────────────────────────────────────────────────
function getVisibleMembers() {
  return ALL_MEMBERS.filter(m => m.chamber === (currentChamber === 'house' ? 'House' : 'Senate'));
}

function updateSpotlightVisibility() {
  const chamber = currentChamber === 'house' ? 'House' : 'Senate';
  document.querySelectorAll('.spotlight-btn').forEach(btn => {
    const chambers = btn.dataset.chambers || 'House,Senate';
    const applies = chambers.includes(chamber);
    btn.style.display = applies ? '' : 'none';
    // If active spotlight no longer applies, clear it
    if (!applies && activeSpotlight === btn.dataset.key) {
      activeSpotlight = null;
      btn.classList.remove('active');
    }
  });
}

function switchChamber(c) {
  currentChamber = c;
  document.getElementById('btn-house').classList.toggle('active', c === 'house');
  document.getElementById('btn-senate').classList.toggle('active', c === 'senate');
  updateSpotlightVisibility();
  document.getElementById('chamber-label').textContent =
    c === 'house' ? 'House of Representatives' : 'Senate';
  selectedMember = null;
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('member-detail-section').innerHTML = '<h3>Member Detail</h3><p style="font-size:12px;color:#6e7681">Click any seat to see details.</p>';
  document.getElementById('history-section').style.display = 'none';
  renderChart();
  updateStats(getVisibleMembers());
  renderMemberList();
}

function switchScore(val) {
  currentScore = val;
  renderChart();
  updateStats(getVisibleMembers());
  renderMemberList();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function buildSpotlightBar(spotlights) {
  const bar = document.getElementById('spotlight-bar');
  if (!bar) return;
  // Remove existing buttons (keep label)
  bar.querySelectorAll('.spotlight-btn').forEach(b => b.remove());

  Object.entries(spotlights).forEach(([key, group]) => {
    const btn = document.createElement('button');
    btn.className = 'spotlight-btn';
    btn.textContent = group.label;
    btn.style.setProperty('--spot-color', group.color);
    btn.dataset.key = key;

    btn.dataset.chambers = (group.chambers || ['House','Senate']).join(',');
    btn.addEventListener('click', () => {
      const isActive = activeSpotlight === key;
      // Clear all buttons
      bar.querySelectorAll('.spotlight-btn').forEach(b => b.classList.remove('active'));
      // Toggle
      if (isActive) {
        activeSpotlight = null;
      } else {
        activeSpotlight = key;
        btn.classList.add('active');
      }
      renderChart();
    });

    bar.appendChild(btn);
  });
}

async function init() {
  try {
    const [membersRes, refreshRes, spotlightsRes] = await Promise.all([
      fetch('/api/members'),
      fetch('/api/last-refresh'),
      fetch('/api/spotlights'),
    ]);
    ALL_MEMBERS = await membersRes.json();
    SPOTLIGHTS  = await spotlightsRes.json();
    buildSpotlightBar(SPOTLIGHTS);
    updateSpotlightVisibility();
    const info = await refreshRes.json();

    const badge = document.getElementById('refresh-badge');
    if (info.timestamp) {
      const d = new Date(info.timestamp);
      badge.textContent = `${info.members_count} members · ${d.toLocaleDateString()}`;
    }

    renderChart();
    updateStats(getVisibleMembers());
    renderMemberList();
  } catch(e) {
    console.error('Init failed:', e);
  }
}

window.addEventListener('resize', () => renderChart());
document.addEventListener('click', e => {
  if (!e.target.closest('#chart') && !e.target.closest('.side-panel') && !e.target.closest('#mobile-member-card')) {
    document.getElementById('tooltip').style.display = 'none';
  }
});

init();
