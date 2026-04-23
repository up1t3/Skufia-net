# SKUFIA Enterprise: Forum Module Refactor Specification

## 1. Current State Audit
The current implementation of the Global Forum (`#view-forum` in `index.html`, `loadForum` in `features.js`) is rudimentary and falls short of modern enterprise standards. 
- **Deficiencies:** 
  - Uses basic DOM manipulation (`innerHTML`) without a robust rendering engine or templating.
  - No pagination or infinite scroll for topic lists.
  - Lack of a proper "Create Topic" modal or rich text editor (WYSIWYG).
  - Inside a topic (`loadTopicPosts`), there is no way to add a new reply.
  - Styling is extremely basic (`.forum-item`, `.post-item`), lacking the "Cyber-Industrial / Glassmorphism" aesthetic established in the rest of the app (like the Messenger or Market).

## 2. Target UX/UI Architecture (Industrial Standard)
The new Forum must align with modern community platforms (e.g., Discourse, Reddit, modern XenForo) while maintaining the Skufia-Net aesthetic.

### 2.1 Layout & Navigation
- **Topic List View:** 
  - A responsive data-grid or card list (`.forum-topic-card`).
  - Each card must display: Title, Author Avatar, Author Name, Reply Count, Last Activity Timestamp, and upvotes/karma.
  - Hover effects: glow, translation (similar to `.ent-card`).
- **Inside a Topic:**
  - Original Post (OP) highlighted at the top.
  - Replies listed linearly below.
  - Fixed "Reply" sticky bar at the bottom or a prominent floating action button (FAB).
- **Breadcrumbs:** `Главная > Форум > [Название Темы]` for easy navigation back.

### 2.2 Features to Implement
1. **Rich Rendering:** Use HTML templates or robust DOM creation to avoid raw `.innerHTML` string concatenation.
2. **Topic Creation Modal:** A modal (`.modal-content`) with Title input, Category dropdown, and a Content textarea.
3. **Reply System:** A textarea at the bottom of a thread to submit a reply via POST `/topics/{id}/posts`.
4. **State Management:** Implement a `window.forumState` object (similar to `marketState`) to handle pagination, current viewing context, and caching.

## 3. Technical Requirements for Jules
**Target Files:**
- `frontend/index.html` (Update `#view-forum` skeleton and add creation modals).
- `frontend/features.js` (Rewrite `loadForum`, `loadTopicPosts`, add `createTopic`, `replyToTopic`).
- `frontend/style.css` (Add `.forum-topic-card`, `.forum-post`, `.forum-breadcrumbs`, `.forum-reply-box`).

**API Endpoints to Utilize (Assume backend supports these or implement frontend stubs if missing):**
- `GET /topics`
- `GET /topics/{id}/posts`
- `POST /topics` (Body: `{title, content}`)
- `POST /topics/{id}/posts` (Body: `{content}`)
- `POST /posts/{id}/like`

## 4. Acceptance Criteria
- [ ] Clicking on a topic smoothly transitions to the post list with breadcrumbs to go back.
- [ ] No more `alert()` or basic text blocks.
- [ ] UI perfectly matches the Skufia-Net cyberpunk/glassmorphism design language.
- [ ] Users can successfully create topics and post replies without page reloads.
