# Step 12 — Map Rewind + Overview Spacing Fix

## User-requested fixes
- Restored the map presentation from Step 09 only; the Step 11 dark Overview surfaces remain unchanged.
- Removed the Step 10 compact circular cluster override that changed the old map's visual language.
- Restored the original rectangular state/district context cluster presentation.
- Hardened Leaflet sizing for both full and embedded maps so the canvas cannot leave a white tail beneath the rendered map.
- Added a ResizeObserver that calls Leaflet `invalidateSize()` whenever the map container dimensions change.
- Restored the Step 09 overview map sizing/layout, which avoids unnecessary blank space beneath the map panel.

## Intent
This step deliberately changes **map presentation only** plus the overview map container sizing. The Step 11 dark command surfaces and the working backend/data layer are preserved.
