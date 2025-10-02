# Aaron Pitters - Personal Website

## Overview
This is a personal website for Aaron Pitters, an author and founder of STORiCORE. The site is a single-page application (SPA) built with vanilla HTML, CSS (Tailwind CDN), and JavaScript.

## Project Structure
- `index.html` - Main HTML file containing all sections (Home, About, Books, STORiCORE, Blog, Contact)
- `server.py` - Python HTTP server for serving static files
- `*.png`, `*.ico` - Favicon and app icons
- `site.webmanifest` - Web app manifest for PWA support

## Technology Stack
- **Frontend**: HTML5, CSS3, JavaScript (vanilla)
- **Styling**: Tailwind CSS (via CDN)
- **Server**: Python 3.11 HTTP server
- **Deployment**: Replit Autoscale

## Server Configuration
- Host: `0.0.0.0`
- Port: `5000`
- Server includes cache control headers to prevent caching issues
- Socket reuse enabled for quick restarts

## Development
The site is served via a simple Python HTTP server that:
- Serves static files from the root directory
- Redirects `/` to `/index.html`
- Sets cache control headers to prevent browser caching during development

## Deployment
Configured for Replit Autoscale deployment:
- Run command: `python3 server.py`
- Port: 5000
- No build step required (static site)

## Navigation
The site uses client-side JavaScript for SPA navigation:
- Hash-based routing (`#home`, `#about`, `#books`, etc.)
- Active link highlighting
- Browser back/forward support

## Recent Changes
- 2025-10-02: Initial setup in Replit environment
  - Installed Python 3.11
  - Created HTTP server with cache control
  - Configured workflow for port 5000
  - Set up autoscale deployment
  - Added .gitignore for Python files

## Notes
- Tailwind CSS is loaded via CDN (shows warning in console - this is acceptable for this simple site)
- No backend or database required
- All content is static
