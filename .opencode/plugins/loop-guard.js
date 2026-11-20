// Loop guard (OpenCode 2 plugin, loaded automatically from .opencode/plugins/).
//
// A local model sometimes repeats its last action word for word: on CARD-067 Bob ran one identical command 177 times
// in a row. This plugin sees every tool call before it runs and refuses the ones that are part of a loop, with a
// message the model reads as the tool's answer. If the agent keeps looping after several refusals, the session's
// turn is interrupted, so it waits for James instead of burning time.
//
// Rules, per session:
//   1. The same tool with the same input 3 times in a row: refused.
//   2. Ping-pong, two calls taking turns (A B A B A B): refused.
//   3. 25 reads or searches in a row with nothing else: refused once, then the count starts again.
//   4. 6 refusals within 10 minutes: the turn is interrupted.
// A different call resets rules 1 and 2. Nothing is stored on disk.

const SAME_IN_A_ROW = 3;
const PING_PONG_WINDOW = 6;
const READS_IN_A_ROW = 25;
const REFUSALS_TO_STOP = 6;
const REFUSAL_WINDOW_MS = 10 * 60 * 1000;
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'list']);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function describe(tool, input) {
  const detail = input?.command ?? input?.filePath ?? input?.path ?? input?.pattern ?? '';
  return `${tool} ${String(detail).replace(/\s+/g, ' ').slice(0, 120)}`.trim();
}

export default {
  id: 'project.loop-guard',
  async setup(ctx) {
    const sessions = new Map();
    const stateOf = (id) => {
      let s = sessions.get(id);
      if (!s) {
        s = { recent: [], reads: 0, refusals: [] };
        sessions.set(id, s);
      }
      return s;
    };

    async function refuse(event, s, message) {
      const now = Date.now();
      s.refusals = s.refusals.filter((t) => now - t < REFUSAL_WINDOW_MS);
      s.refusals.push(now);
      if (s.refusals.length >= REFUSALS_TO_STOP && event.sessionID) {
        // Keep `recent`: the same call stays refused after the stop.
        s.refusals = [];
        try {
          await ctx.session.interrupt({ sessionID: event.sessionID, resume: false });
        } catch {
          // Interrupting is a bonus: the refusal below still stops the call.
        }
        throw new Error(
          `LOOP GUARD: you have been stopped. You kept repeating the same actions after ${REFUSALS_TO_STOP} warnings. ` +
            'When James continues the session: say in one or two sentences what you were trying to do and why it did ' +
            'not work, then either take a clearly different step or write the problem under "Blockers / questions".',
        );
      }
      throw new Error(`LOOP GUARD: ${message}`);
    }

    await ctx.tool.hook('execute.before', async (event) => {
      const s = stateOf(event.sessionID ?? 'unknown');
      const key = `${event.tool} ${stable(event.input ?? {})}`;
      const what = describe(event.tool, event.input);

      // Rule 1: the same call again and again.
      const last = s.recent.slice(-(SAME_IN_A_ROW - 1));
      if (last.length === SAME_IN_A_ROW - 1 && last.every((k) => k === key)) {
        await refuse(
          event,
          s,
          `refused. You have already run exactly this ${SAME_IN_A_ROW - 1} times in a row (${what}), and running it ` +
            'again will give the same result. Do not repeat it. Use the result you already have, or step back: ' +
            're-read the next step of the card, try a different approach, or write the problem under ' +
            '"Blockers / questions" and stop.',
        );
      }

      // Rule 2: two calls taking turns.
      const window = [...s.recent.slice(-(PING_PONG_WINDOW - 1)), key];
      if (window.length === PING_PONG_WINDOW) {
        const [a, b] = window;
        const alternating = a !== b && window.every((k, i) => k === (i % 2 === 0 ? a : b));
        if (alternating) {
          await refuse(
            event,
            s,
            `refused. You are going back and forth between the same two actions (${what} and one other) without ` +
              'progress. Stop and think about why the result does not change. Change your approach, or write the ' +
              'problem under "Blockers / questions".',
          );
        }
      }

      // Rule 3: reading without doing anything.
      if (READ_TOOLS.has(event.tool)) {
        s.reads += 1;
        if (s.reads > READS_IN_A_ROW) {
          s.reads = 0;
          await refuse(
            event,
            s,
            `refused. You have read or searched ${READS_IN_A_ROW} times in a row without changing anything. You have ` +
              'enough context: follow AGENTS.md "Work smart" and the card, open only the file you are about to ' +
              'change, and make the change. Searching or reading again is allowed after you have done something.',
          );
        }
      } else {
        s.reads = 0;
      }

      s.recent.push(key);
      if (s.recent.length > 20) s.recent.shift();
    });
  },
};
