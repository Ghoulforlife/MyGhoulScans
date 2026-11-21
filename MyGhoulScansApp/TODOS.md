# MyGhoulScans App — Todo List

Updated: 2026-11-21
Target: Webtoon-style UX. Work one item at a time; build + install each pass.

## 1. Comic Detail Screen (when user clicks a comic)
- [x] Cover thumbnail, title, source/scanlation group
- [x] Chapter count ("96 Chapters")
- [x] Release status badge (Ongoing / Completed)
- [x] Clickable genre pills (Fantasy, Slice of Life, …)
- [x] Collapsible synopsis: 3 lines + "More ⌄" expand
- [x] Primary action bar: Continue Ch. X (red CTA; "Read First" for new readers)
- [x] Bookmark toggle
- [x] Download button → opens batch download drawer

## 2. Batch Download Drawer (Webtoon-style)
- [x] Sheet opens over comic page from Download button
- [x] Checkbox list; long-press + tap = select range
- [x] Pills: Select All (96), Next 10, Next 25, Unread, Clear
- [x] Per-chapter row file size (e.g., 5.4 MB)
- [x] Sticky footer: "N Chapters Selected" · "Est. Size: 52.4 MB" · "18.4 GB Free"
- [x] Confirm Download closes sheet and starts background queue

## 3. Chapter List & Recommendations
- [x] Sort toggle ↑↓ (Oldest first / Newest first)
- [x] Preview first 3–5 chapters + "Show All 96 Chapters ⌄"
- [x] Inline status icons per chapter: ✓ downloaded, ↓ available (queued/downloading state pending)
- [x] "More like this" horizontal carousel: genre-matched, ratings, 1-tap bookmark

## 4. Downloads Tab
- [x] Storage overview bar
- [x] Active downloads monitor: live speed (MB/s) + worker progress
- [x] Series-grouped offline library (cover per comic)
- [x] Expand arrow reveals individual offline chapters in a series
- [x] "Read Offline" on a series opens the next unread downloaded chapter

## 5. Reader
- [x] Prev / Next chapter buttons
- [x] Auto-advance to next chapter at the end
- [x] Webtoon (long-strip) + page modes
- [x] Bigger Read button; whole chapter row tappable
- [x] Eye-care warm tint (long-press brightness) + auto-scroll speed cycle (1x/2x/3x)
- [x] Smart preloading of next chapter

## 6. Offline Architecture
- [x] Sequential chapter queue (already looped sequentially)
- [x] Parallel image fetch (4-worker pool)
- [x] Wi-Fi-only download rule (opt-in in More)
- [x] Local structure `offline_comics/{comic_id}/{chapter_id}/` (existing flat layout + `chapter.json` manifest, written last)
- [x] Corrupt-file recovery (retry once on partial failure)
- [x] Auto-delete after reading (opt-in, 24h)

## 7. Engagement & Extras (mostly needs backend support)
- [x] Streaks (counted locally in DownloadStore.markRead; shown in More/Profile)
- [ ] Cosmetic rewards (frames, titles, colors) — needs server
- [ ] Prediction polls — needs server
- [x] Custom tags / collections — local-only (long-press a library card to tag)
- [ ] Release calendar — needs server
- [ ] Storage auto-clean — folded into auto-delete toggle (24h)
- [ ] Reaction bar / comments — exists on website; native opens via WebView
- [ ] Panel clipper / share card — heavy, deferred

## Done previously
- [x] Back arrow / nav never exits app; tab back → Home
- [x] Library 3-col grid + filters + search
- [x] Home hero banner + cached feeds (faster loading)
- [x] Reader cloud sync (progress + read counts)
- [x] Downloads readability (GB sizes, Read Offline)
- [x] Downloads: tap comic → chapter screen (no inline dropdown)
