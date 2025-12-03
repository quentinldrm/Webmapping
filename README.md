# Webmapping — Project & Data Overview

Live demo: https://quentinldrm.github.io/Webmapping/

## Project summary

Webmapping is an interactive web mapping project designed to present geographic information clearly and accessibly in the browser. The focus is on tidy cartographic presentation and intuitive interactions: visualizing points of interest, vector layers, and displaying contextual information through popups and tooltips. The project serves both as a demonstration platform and as a lightweight viewer for publishing and exploring geospatial datasets.

## What the project offers

- Clean, map-centered visualization of geographic features.
- Intuitive display of feature attributes via popups or tooltips.
- Support for multiple vector layers (points, lines, polygons) to compare and combine datasets.
- Aimed at educational demos, quick visual inspection of data, and public presentation of geolocated inventories.

## Data used

### Data types
- Vector formats (primarily GeoJSON).
- CSV files that can be converted to GeoJSON for spatial display.
- Collections of points (point-of-interest datasets), lines (routes, traces), and polygons (zones, boundaries).

### Basemaps
- Map context is provided by online tile services (for example OpenStreetMap or other tile providers), used as background layers to situate vector data.

### Sources
- Public open data portals (local, regional, national).
- OpenStreetMap extracts or exports.
- User-supplied GeoJSON files included in the repository for demonstration purposes.

### Attributes & metadata
- Each feature can carry descriptive properties such as: name, type, description, category, and external links.
- These attributes are surfaced in the UI (popups or side panels) to give context to the mapped elements.

### Licensing & attribution
- Data sources must be correctly attributed according to their licenses (e.g., ODbL for OpenStreetMap or dataset-specific licenses).
- When republishing or redistributing datasets, follow the original license terms and include attribution statements where required.

## Typical use cases

- Quick visual exploration of a geospatial dataset.
- Presentation of territorial projects or public inventories (e.g., points of interest, infrastructure, protected areas).
- Educational demonstrations for web mapping and geospatial data formats.
- Lightweight public-facing viewers for project stakeholders.

## Notes & recommendations

- Where possible, include a short metadata file or README alongside each dataset that lists the origin, date, license, and a brief description of fields.
- Prefer GeoJSON for vector data to simplify integration and styling in the web viewer.
- Always verify and display proper attribution for basemaps and data providers.

---
