# SKUFIA Enterprise: Wiki (Knowledge Base) Refactor Specification

## 1. Current State Audit
The "База Знаний" (Wiki) module `#view-wiki` is critically flawed.
- **Deficiencies:**
  - Clicking "ОТКРЫТЬ ДАННЫЕ" (Open Data) on an article calls `loadWikiArticle()`, which executes a native browser `alert()` to display the content (`alert('--- ГИПЕРТЕКСТОВАЯ БАЗА --- ...')`). This is entirely unacceptable for a modern enterprise platform.
  - The sidebar navigation is hardcoded (`<ul><li>Железо 90-х...</ul>`) and non-functional. Clicking categories does nothing.
  - The layout lacks a dedicated reading view for articles, inline media support, or rich formatting (Markdown/HTML).

## 2. Target UX/UI Architecture (Industrial Standard)
The Wiki must function as a seamless Single Page Application (SPA) document reader, similar to Notion, GitBook, or Confluence, infused with the Skufia Cyberpunk aesthetic.

### 2.1 Layout & Navigation
- **Two-Pane Layout:**
  - **Left Pane (Sidebar):** Dynamic list of Categories or Article Titles fetched from the API. Highlighting the currently active article.
  - **Right Pane (Content Viewer):** The main reading area.
- **Content Viewer Design:**
  - Clean, legible typography (`font-family: 'Inter'`).
  - Maximum reading width (e.g., `800px` centered) for readability.
  - "Last Updated" timestamp, "Author", and "Like / Upvote" buttons cleanly integrated at the top/bottom of the article.
  - Support for displaying rich text (if the backend returns HTML) or at least properly formatted paragraphs with `white-space: pre-wrap`.

### 2.2 Features to Implement
1. **Dynamic Sidebar:** Fetch articles from `/wiki` and populate the left sidebar. Group them by category if the API supports it, or just list titles.
2. **In-App Reader:** Remove `alert()`. Replace it with a function that injects the article's `content` into the `.wiki-content` div.
3. **Smooth Transitions:** Add fade-in animations when switching articles.
4. **Interactive Actions:** Move the "Like/Одобрить" button from the list view into the article reading view for better contextual interaction.

## 3. Technical Requirements for Jules
**Target Files:**
- `frontend/index.html` (Refactor `.wiki-layout`, remove hardcoded `<ul>`).
- `frontend/features.js` (Rewrite `loadWiki` and `loadWikiArticle`).
- `frontend/style.css` (Add classes for `.wiki-article-view`, `.wiki-nav-item`, `.wiki-title`).

**API Endpoints:**
- `GET /wiki`
- `GET /wiki/{id}`
- `POST /wiki/{id}/like`

## 4. Acceptance Criteria
- [ ] Clicking on an article opens it gracefully within the `.wiki-content` pane.
- [ ] Native browser `alert()` is completely eradicated from the Wiki flow.
- [ ] Sidebar accurately reflects the available articles and allows quick switching.
- [ ] The typography and spacing make long-form reading comfortable while keeping the glassmorphism styling.
