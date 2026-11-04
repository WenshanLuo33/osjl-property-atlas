# Ocean State Job Lot | Property Atlas

An interactive web-based research platform developed to analyze the retail locations, real estate portfolio, and property redevelopment strategies of **Ocean State Job Lot (OSJL)**, a discount retail chain operating across the Northeast and Mid-Atlantic United States.

The project examines OSJL's geographic distribution, property ownership and leasing strategies, retail center typologies, and physical changes to commercial properties over time.

## Research Objectives

The research focuses on three primary questions:

1. **Where does OSJL operate and invest?** Map OSJL retail stores and real estate holdings across the region.
2. **What types of retail properties are involved?** Classify properties by ownership structure and spatial layout.
3. **How do properties change over time?** Compare tenant occupancy, storefront renovations, site improvements, and adaptive reuse before and after property acquisitions.

## Website Features

### 1. Property Map

An interactive geographic overview of OSJL retail stores and real estate properties.

- Maps 183 retail and property locations.
- Color-codes locations by property ownership and occupancy type.
- Displays property information through interactive map markers.
- Supports location searches and ownership-based filtering.
- Provides street map and satellite imagery views.
- Links directly to Google Maps.

### 2. Renovation Review

A comparative analysis of physical changes to OSJL-related properties.

- Separates properties with documented improvements from those with no observed improvements.
- Displays property information, including store area, shopping center GLA, tenants, acquisition history, and ownership type.
- Presents before-and-after photographs and available site plans.
- Includes interactive satellite maps for each property.
- Highlights changes such as tenant replacement, façade renovation, parking lot modifications, landscaping, and adaptive reuse.

### 3. Ownership & Retail Typology

A hierarchical exploration of OSJL properties based on ownership structure and retail center configuration.

**Property Ownership & Occupancy Types**
- Owned + OSJL Store
- Owned + No OSJL Store
- Leased OSJL Store
- Ground / Master Leased Property

**Retail Center Typologies**

Properties are further categorized by their physical layouts, including standalone big-box buildings, multi-tenant big-box buildings, linear strip centers, L-shaped and U-shaped shopping centers, and multi-building clusters.

Interactive property cards and satellite maps support visual comparisons across different categories.

## Data & Methodology

The platform draws on research compiled from:

- OSJL official store listings and real estate publications
- Commercial real estate listings and leasing brochures
- Public acquisition announcements and property records
- Google Maps and historical Street View imagery
- Satellite imagery and available site plans
- Manual site classification and before-and-after comparisons

The website is **CSV-driven**, allowing property information, classifications, and renovation records to be updated without modifying the underlying website code.

Research findings reflect the available sources and observations at the time of compilation. Historical acquisition records do not necessarily establish current ownership, and visible exterior changes do not capture all interior renovations.

## Technology

- HTML, CSS, and JavaScript
- Leaflet.js for interactive mapping
- OpenStreetMap and Esri satellite imagery
- CSV-based data management

## Project Structure

```text
osjl-property-atlas/
├── index.html
├── app.js
├── styles.css
├── DATA/
│   ├── [Store Locations CSV]
│   └── [Property Portfolio CSV]
├── PICTURE/
│   └── [Before and After Images]
├── PLAN/
│   └── [Site Plans]
└── START_WEBSITE.bat
```

## Running Locally

1. Clone or download the repository.
2. Ensure the required CSV files are located in the `DATA` folder.
3. Start a local web server using `START_WEBSITE.bat` or VS Code Live Server.
4. Open the website in your browser.

The application reads the CSV files locally and updates its visualizations as the datasets change.

## Research Scope

This platform is an evolving research resource rather than a definitive property ownership registry. Property classifications, historical redevelopment information, and acquisition records are continually refined as additional evidence becomes available.

---

**Project:** Ocean State Job Lot Retail & Real Estate Research  
**Organization:** Arrowstreet  
**Focus:** Retail Planning · Commercial Real Estate · Site Typology · Adaptive Reuse