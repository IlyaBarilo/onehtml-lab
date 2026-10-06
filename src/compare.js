// Token-level diff keeps short code changes readable without treating HTML as markup.
function codeTokens(code) {
  return code.match(/\r\n|\r|\n|[^\S\r\n]+|[A-Za-z0-9_\u0400-\u04FF]+|[^\r\n]/g) || [];
}

function codeDiff(before, after) {
  const oldTokens = codeTokens(before);
  const newTokens = codeTokens(after);
  let start = 0;
  while (start < oldTokens.length && start < newTokens.length && oldTokens[start] === newTokens[start]) start++;
  let oldEnd = oldTokens.length;
  let newEnd = newTokens.length;
  while (oldEnd > start && newEnd > start && oldTokens[oldEnd - 1] === newTokens[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const result = [];
  function append(type, text) {
    if (!text) return;
    const last = result[result.length - 1];
    if (last?.type === type) last.text += text;
    else result.push({ type, text });
  }
  append('same', oldTokens.slice(0, start).join(''));
  const oldMiddle = oldTokens.slice(start, oldEnd);
  const newMiddle = newTokens.slice(start, newEnd);
  if (!oldMiddle.length) append('added', newMiddle.join(''));
  else if (!newMiddle.length) append('removed', oldMiddle.join(''));
  else {
    const length = oldMiddle.length + newMiddle.length;
    let frontier = new Map([[1, 0]]);
    const trace = [];
    let completed = false;
    // A completely different large game can be shown as one replacement.
    const limit = Math.min(length, 800);
    for (let depth = 0; depth <= limit && !completed; depth++) {
      trace.push(new Map(frontier));
      const next = new Map();
      for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
        const down = diagonal === -depth || (diagonal !== depth &&
          (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1));
        let x = down ? (frontier.get(diagonal + 1) ?? 0) : (frontier.get(diagonal - 1) ?? 0) + 1;
        let y = x - diagonal;
        while (x < oldMiddle.length && y < newMiddle.length && oldMiddle[x] === newMiddle[y]) { x++; y++; }
        next.set(diagonal, x);
        if (x >= oldMiddle.length && y >= newMiddle.length) {
          let backX = oldMiddle.length;
          let backY = newMiddle.length;
          const steps = [];
          for (let backDepth = depth; backDepth >= 0; backDepth--) {
            const previous = trace[backDepth];
            const backDiagonal = backX - backY;
            const cameDown = backDiagonal === -backDepth || (backDiagonal !== backDepth &&
              (previous.get(backDiagonal - 1) ?? -1) < (previous.get(backDiagonal + 1) ?? -1));
            const priorDiagonal = cameDown ? backDiagonal + 1 : backDiagonal - 1;
            const priorX = previous.get(priorDiagonal) ?? 0;
            const priorY = priorX - priorDiagonal;
            while (backX > priorX && backY > priorY) {
              steps.push(['same', oldMiddle[--backX]]);
              backY--;
            }
            if (backDepth > 0) {
              if (cameDown) steps.push(['added', newMiddle[--backY]]);
              else steps.push(['removed', oldMiddle[--backX]]);
            }
          }
          for (let index = steps.length - 1; index >= 0; index--) append(...steps[index]);
          completed = true;
          break;
        }
      }
      frontier = next;
    }
    if (!completed) {
      append('removed', oldMiddle.join(''));
      append('added', newMiddle.join(''));
    }
  }
  append('same', oldTokens.slice(oldEnd).join(''));
  return result;
}

// Only complete unchanged lines can be hidden. Offsets refer to the full diff,
// including removed text, and retain the original newline bytes.
function comparisonLineGaps(parts, contextLines = 3) {
  let source = '';
  const changes = [];
  for (const part of parts) {
    const from = source.length;
    source += part.text;
    if (part.type !== 'same' && part.text) changes.push({ from, to: source.length });
  }
  const lines = [];
  let from = 0;
  for (const newline of source.matchAll(/\r\n|\r|\n/g)) {
    const to = newline.index + newline[0].length;
    lines.push({ from, to });
    from = to;
  }
  if (from < source.length) lines.push({ from, to: source.length });
  const visible = new Uint8Array(lines.length);
  let changeIndex = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    while (changes[changeIndex]?.to <= line.from) changeIndex++;
    if (changes[changeIndex]?.from < line.to) {
      visible.fill(1, Math.max(0, index - contextLines), Math.min(lines.length, index + contextLines + 1));
    }
  }
  const gaps = [];
  for (let index = 0; index < lines.length;) {
    if (visible[index]) { index++; continue; }
    const first = index;
    while (index < lines.length && !visible[index]) index++;
    gaps.push({ id: first, from: lines[first].from, to: lines[index - 1].to, count: index - first });
  }
  return { source, gaps };
}

function comparisonChunks(parts, gaps) {
  const result = [];
  let position = 0, gapIndex = 0;
  for (const part of parts) {
    const start = position, end = start + part.text.length;
    while (position < end) {
      const gap = gaps[gapIndex];
      if (gap && position >= gap.from) {
        if (position === gap.from) result.push({ type: 'gap', gap });
        position = Math.min(end, gap.to);
        if (position === gap.to) gapIndex++;
      } else {
        const to = Math.min(end, gap?.from ?? end);
        const text = part.text.slice(position - start, to - start);
        const last = result[result.length - 1];
        if (last?.type === part.type) last.text += text;
        else result.push({ type: part.type, text });
        position = to;
      }
    }
  }
  return result;
}
