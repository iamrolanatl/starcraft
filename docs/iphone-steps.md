# Connect iPhone steps (Apple Health → Crystal)

Endpoint: `POST https://crystal-7ot.pages.dev/api/health/steps`
Header: `Authorization: Bearer <your token>` (create/copy it in Crystal → Health → Steps → **Connect iPhone** while signed in)
Body (JSON): `{"date":"2026-10-14","steps":8123}` plus optional `distance` (km), `activeEnergy` (kcal), `flights`.
Backfill: `{"days":[{"date":"…","steps":…}, …]}` (up to 40 days).

Rules: the token is stored only as a SHA-256 hash. Blank, zero or smaller values never overwrite a day that already has a value; the larger value is kept. Every call is logged in `health_ingest_log`.

## A. Daily automation (9 PM)
1. Shortcuts app → **Automation** tab → **+** → **Time of Day** → 9:00 PM, **Daily** → **Run Immediately** → Next → **New Blank Automation**.
2. **Find Health Samples** → tap *Type* → **Steps**. Filter: **Start Date is today**. (Leave Sort/Limit off.)
3. **Calculate Statistics** → **Sum** of *Health Samples*.
4. **Format Date** → *Current Date* → Date Format **Custom** → `yyyy-MM-dd`.
5. **Get Contents of URL** → URL: the endpoint above. Tap ▸ to expand:
   - Method **POST**
   - Headers → Add `Authorization` = `Bearer hst_…` (your token, with the word Bearer and a space)
   - Request Body **JSON** → Add field `date` (Text) = *Formatted Date*; add field `steps` (Number) = *Statistics*.
   - Optional extra fields: repeat steps 2–3 for *Walking + Running Distance* → `distance`, *Active Energy* → `activeEnergy`, *Flights Climbed* → `flights`.
6. Done. Tap the automation once and choose Run to test; Crystal's Health applet should show "iPhone sync …".

## B. Hourly (optional)
iOS has no "every hour" trigger. Duplicate automation A for the hours you want (e.g. 9 AM, noon, 3 PM, 6 PM), each **Run Immediately**. Repeats are safe: Crystal keeps the larger value per day.

## C. 7-day backfill (run once, by hand)
Make a normal Shortcut (My Shortcuts → +):
1. **Repeat** 7 times.
2. Inside: **Adjust Date** → Current Date → Subtract *Repeat Index* days → then **Adjust Date** again Add 1 day (so index 1 = today).
3. **Find Health Samples** Steps where Start Date **is** *Adjusted Date* (same day).
4. **Calculate Statistics** Sum. **Format Date** Adjusted Date as `yyyy-MM-dd`.
5. **Get Contents of URL**, same as A step 5.
6. End Repeat. Run it once.

Tip: if Shortcuts asks to allow access to Health or to crystal-7ot.pages.dev, tap **Always Allow**.

## Test with curl
```
curl -X POST https://crystal-7ot.pages.dev/api/health/steps -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"date":"2026-10-14","steps":1234}'
```
