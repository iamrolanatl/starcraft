# Data validation strategy: a bad pull never erases good data

**Goal:** a blank, partial or broken school pull can never replace data Crystal already has. The same rules apply to
every future auto-sync (health, finance, mail, and so on) through one shared helper, `sync/merge.py`.

## The pipeline, and where each check sits
1. The laptop pulls ParentVUE (one login attempt, no retries) and uploads a zip.
2. The box poller downloads the zip, removes CTLS session secrets in memory, and **archives it for 30 days** (`~/.local/state/crystal/raw-archive/`).
3. The zip is parsed in a **staging copy** of the Eli data folder. The live folder is not touched yet.
4. `school_sync.py` runs the **pull-level gates** (below). If any gate fails, the pull is **quarantined** and processing stops. Nothing in Supabase or in the live folder changes.
5. If the gates pass, every value is **type-checked**, then **merged field by field** into Supabase. Only then are the staged files promoted to the live folder (the old ones are backed up first).
6. Every run is written to `edu_sync_runs` with counts of accepted, kept-old and rejected fields, plus a reason.

## 1. Pull-level gates (all or nothing)
A pull is quarantined when any of these is true:
- Fewer than **7 of the 9** ParentVUE requests succeeded, or the login request (ChildList) failed. Cobb's StudentInfo and StudentSchoolInfo fail on every pull, so 7 is the normal healthy count.
- The gradebook (courses), the schedule, or the student section is empty.
- The course count dropped by **more than 1** compared with the last good pull.
- There are **zero assignments** when the last good pull had 5 or more **in the same term**. At a term change, an empty new term is legitimate.
- The pull has no timestamp.

What happens to a quarantined pull:
- The raw zip, the parsed data and the reasons are saved in `~/.local/state/crystal/quarantine/<time>_job<id>/`.
- The job is marked failed with the reason "quarantined: …".
- The run is logged with status `quarantined`.
- A **quarantined** alert goes to the Crystal feed and the email outbox.

The "last good pull" summary (term, course, assignment and schedule counts) is stored in `edu_students.last_good`. It is only updated after an accepted pull.

## 2. Field-level, non-destructive merge
- A blank incoming value never overwrites a known value. Blank means null, an empty string, "N/A", "-", an empty list or an empty object. The old value is kept and counted as **kept_old**.
- A genuinely new non-blank value replaces the old one and is counted as **accepted**. The row's `last_changed_at` is bumped.
- Every row the pull contains gets `last_seen_at`.
- **Grades:** "N/A" at a term change is a real status. It is stored in the new snapshot as the latest status mark, but it never erases:
  - prior-term finals, which are separate immutable rows; a blank final is never recorded;
  - the last numeric grade, which the `edu_grades_current` view still shows.
- A blank teacher name, email or period in a grade snapshot is carried forward from that course's previous snapshot.

## 3. Row-level rules
- Rows are never hard-deleted because they're missing from one pull.
- A row missing from a good pull gets `missing_since`, and `missing_count` counts consecutive good pulls without it.
- After **3** consecutive good pulls without it, the row gets `archived_at`. It is hidden, not deleted.
- At a **term change**, assignments missing from the new term are archived at once.
- A row that reappears is un-missed and un-archived.
- Assignments, messages, calendar and attendance are append and update only.

## 4. Immutable snapshots
- `edu_grades` is append-only. Each pull adds rows keyed by its timestamp, and a database trigger refuses updates and deletes.
- `edu_grades_current` gives, per course and term, the **latest non-empty percent**, the mark that came with it, `percent_as_of`, and separately the latest status mark (for example "N/A").

## 5. Schema and type checks
A value that fails a check is dropped (never written) and logged in the run's `reason`:
- **Course percent:** must be 0–100.
- **Assignment percent:** must be 0–150, to allow for extra credit.
- **Dates and timestamps:** must be valid ISO values.
- **Teacher email:** must look like name@domain.
- **Required keys:**
  - grades: course, course key, term and timestamp;
  - assignments: name and id;
  - attendance: date and kind;
  - calendar: date and title.
  
  A row missing a required key is dropped.

## 6. Audit trail and replay
- **`edu_sync_runs`:**
  - status (`ok`, `failed` or `quarantined`);
  - the counts `fields_accepted`, `fields_kept` and `fields_rejected`;
  - `reason` (gate reasons or the validation log);
  - `raw_path` and `job_id`.
- **Raw zips:** kept for 30 days on the box and in Supabase storage. After that they are deleted, and `sync_requests.raw_purged_at` is stamped.
- **Replay:** `python3 sync/poller.py --replay <zip>` runs any archived zip through the same staging, gates and merge.

## 7. Alerts
These alert kinds appear in the Crystal feed and the email outbox, once per incident:
- `quarantined`
- `box_failed`
- `laptop_failed`
- `missed_pull`

## 8. Reusing this for other modules
`sync/merge.py` holds the shared pieces:
- `is_blank`
- `merge_fields`: old and new record, returning the merged record plus accepted and kept-old counts;
- `merge_rows`: a row set with missing and archive tracking;
- the validators `v_pct`, `v_date`, `v_ts` and `v_email`, plus `clean`.

Every new auto-sync must:
- define its own pull-level gates (expected sections and counts against its own last-good summary);
- validate values with these helpers;
- merge with `merge_fields` and `merge_rows`, never a blind upsert;
- write a run row with the three counts;
- quarantine instead of writing when a gate fails.
