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
