# Education › Learn: weekly refresh

Learn shows, for each of Eli's current classes, the unit we believe is being taught now, the evidence behind it, a unit timeline, and links that were checked before they were added.

## Data
- `learn_units` holds one row per class and unit. `status` is current, upcoming, past, done or unknown. `source` says whether the unit came *from syllabus*, *from assignments (gradebook)* or was *inferred from assignments*. Each row also has `confidence`, `evidence` and a `timeline`.
- `learn_resources` holds class, unit, title, https URL, type (Videos / Practice/Games / Readings / Cobb resources), source badge, `for_assignment` and `verified_at`. Set `active=false` when a link later fails. Rows are never deleted.
- `learn_history` keeps an audit row for every insert or update; deletes are blocked by a trigger. The owner can read all three tables (RLS); only the box's service role writes.
- Migration: `supabase/migrations/015_learn.sql`. Until it is run, the UI shows the snapshot bundled in `src/lib/learn-snapshot.json`.

## Weekly routine (suggested: Sunday evening, after the 5:40 PM pull)
1. `python3 sync/learn_refresh.py` reads the newest zip in `~/.local/state/crystal/raw-archive/` and prints each class as `RESEARCH`, `ok` or `inactive`, with reasons (new assignments, test or unit signals, unknown unit, research older than 7 days) and assignments due in the next 14 days. Add `--json` for machine output. If a pull has no current-period gradebook, the script refuses to judge it, so a blank pull never changes anything.
2. For each `RESEARCH` class, update `sync/learn/seed.json` using real sources only: gradebook assignment names, Cobb curriculum maps and parent letters (media.cobbk12.org), teacher pages or syllabi, CTLS Learn exports, and the Georgia standards. Label every unit `from syllabus` or `inferred from assignments`, and give its confidence and evidence. If nothing supports a unit, mark it unknown rather than guess.
3. Add links to `sync/learn/resources.json`. Check each one first: it must return HTTP status < 400 with a real page title, not a challenge or "sunset" page. Set `for_assignment` for prep links tied to a named upcoming assignment.
4. `python3 sync/learn_refresh.py --stamp --load --verify` records the assignment names that were researched, upserts the units and links (a class's old unit becomes `past`), and re-checks every stored link.
5. Commit the seed and resources files, and refresh `src/lib/learn-snapshot.json` if you want the fallback to match.
