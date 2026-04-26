/**
 * Virtual DOM rendering engine for chat messages.
 * Implements Fixed Height Cache and Virtual Viewport as per docs/enterprise/05_frontend_state_machine.md
 */
class VirtualScroller {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.items = options.items || [];
        this.renderItem = options.renderItem || ((item) => {
            const div = document.createElement('div');
            div.textContent = typeof item === 'string' ? item : JSON.stringify(item);
            return div;
        });
        this.estimatedItemHeight = options.estimatedItemHeight || 50;
        this.bufferCount = options.bufferCount || 5; // Extra items to render above/below viewport

        // Cache for observed heights
        this.heightCache = new Map();

        // Internal state
        this.startIndex = 0;
        this.endIndex = 0;
        this.scrollTop = 0;
        this.containerHeight = 0;

        // DOM nodes currently rendered
        this.renderedNodes = new Map(); // Map<index, HTMLElement>

        this.initDOM();
        this.setupObservers();

        // Initial render
        this.updateVirtualViewport();
    }

    initDOM() {
        // Ensure container is scrollable and positioned
        const style = window.getComputedStyle(this.container);
        if (style.position === 'static') {
            this.container.style.position = 'relative';
        }
        this.container.style.overflowY = 'auto';

        // Create inner spacer to represent total height
        this.spacer = document.createElement('div');
        this.spacer.className = 'virtual-scroller-spacer';
        this.spacer.style.width = '1px';
        this.spacer.style.opacity = '0';
        this.container.appendChild(this.spacer);

        // Create content wrapper to hold actual items
        this.contentWrapper = document.createElement('div');
        this.contentWrapper.className = 'virtual-scroller-content';
        this.contentWrapper.style.position = 'absolute';
        this.contentWrapper.style.top = '0';
        this.contentWrapper.style.left = '0';
        this.contentWrapper.style.right = '0';
        this.container.appendChild(this.contentWrapper);
    }

    setupObservers() {
        // Track container resize to update visible item count
        this.resizeObserver = new ResizeObserver(entries => {
            let needsUpdate = false;

            for (let entry of entries) {
                if (entry.target === this.container) {
                    // Use borderBoxSize if available for more accurate container height, fallback to offsetHeight
                    this.containerHeight = entry.borderBoxSize ? entry.borderBoxSize[0].blockSize : entry.target.offsetHeight;
                    needsUpdate = true;
                } else {
                    // Update cache for individual items if their height changes
                    const index = parseInt(entry.target.dataset.index, 10);
                    if (!isNaN(index)) {
                        // Use borderBoxSize for accurate height including padding/borders
                        const newHeight = entry.borderBoxSize ? entry.borderBoxSize[0].blockSize : entry.target.offsetHeight;
                        if (this.heightCache.get(index) !== newHeight && newHeight > 0) {
                            this.heightCache.set(index, newHeight);
                            needsUpdate = true;
                        }
                    }
                }
            }

            if (needsUpdate) {
                this.updateVirtualViewport();
            }
        });

        this.resizeObserver.observe(this.container);

        // Scroll listener with requestAnimationFrame for performance
        let isTicking = false;
        this.container.addEventListener('scroll', () => {
            this.scrollTop = this.container.scrollTop;
            if (!isTicking) {
                window.requestAnimationFrame(() => {
                    this.updateVirtualViewport();
                    isTicking = false;
                });
                isTicking = true;
            }
        });
    }

    setItems(items) {
        this.items = items;
        this.updateVirtualViewport();
    }

    // Get total height of all items up to `index`
    getOffsetForIndex(index) {
        let offset = 0;
        for (let i = 0; i < index; i++) {
            offset += this.heightCache.get(i) || this.estimatedItemHeight;
        }
        return offset;
    }

    // Find the first visible index based on current scroll top
    findStartIndex() {
        let offset = 0;
        for (let i = 0; i < this.items.length; i++) {
            const height = this.heightCache.get(i) || this.estimatedItemHeight;
            if (offset + height > this.scrollTop) {
                return i;
            }
            offset += height;
        }
        return 0;
    }

    updateVirtualViewport() {
        if (!this.containerHeight) {
            this.containerHeight = this.container.clientHeight;
        }

        if (this.items.length === 0 || this.containerHeight === 0) {
            this.spacer.style.height = '0px';
            this.contentWrapper.innerHTML = '';
            this.renderedNodes.clear();
            return;
        }

        // Calculate total scrollable height
        let totalHeight = 0;
        for (let i = 0; i < this.items.length; i++) {
            totalHeight += this.heightCache.get(i) || this.estimatedItemHeight;
        }
        this.spacer.style.height = `${totalHeight}px`;

        // Calculate visible range
        const firstVisibleIndex = this.findStartIndex();
        let currentOffset = this.getOffsetForIndex(firstVisibleIndex);

        let lastVisibleIndex = firstVisibleIndex;
        let visibleHeight = 0;

        while (lastVisibleIndex < this.items.length && visibleHeight < this.containerHeight) {
            visibleHeight += this.heightCache.get(lastVisibleIndex) || this.estimatedItemHeight;
            lastVisibleIndex++;
        }

        // Add buffers
        this.startIndex = Math.max(0, firstVisibleIndex - this.bufferCount);
        this.endIndex = Math.min(this.items.length - 1, lastVisibleIndex + this.bufferCount);

        // Mount/Unmount nodes
        const nodesToKeep = new Set();

        // Calculate offset for the wrapper
        const wrapperOffset = this.getOffsetForIndex(this.startIndex);
        this.contentWrapper.style.transform = `translateY(${wrapperOffset}px)`;

        let itemOffset = 0;

        for (let i = this.startIndex; i <= this.endIndex; i++) {
            nodesToKeep.add(i);

            let node = this.renderedNodes.get(i);

            if (!node) {
                // Mount new node
                node = this.renderItem(this.items[i], i);
                node.dataset.index = i;
                node.style.position = 'absolute';
                node.style.top = '0';
                node.style.left = '0';
                node.style.right = '0';
                node.style.transform = `translateY(${itemOffset}px)`;

                this.contentWrapper.appendChild(node);
                this.renderedNodes.set(i, node);

                // Observe for height changes if not cached yet
                this.resizeObserver.observe(node);
            } else {
                // Update existing node position
                node.style.transform = `translateY(${itemOffset}px)`;
            }

            // Add height for next item
            itemOffset += this.heightCache.get(i) || this.estimatedItemHeight;
        }

        // Unmount nodes outside viewport
        for (const [index, node] of this.renderedNodes.entries()) {
            if (!nodesToKeep.has(index)) {
                this.resizeObserver.unobserve(node);
                node.remove();
                this.renderedNodes.delete(index);

                // Handle Lottie pauses if applicable, e.g., node.querySelector('lottie-player').pause()
                // In a real app we might fire an event or call a method on the node
            }
        }
    }
}

// Export for ES modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VirtualScroller;
} else {
    window.VirtualScroller = VirtualScroller;
}
