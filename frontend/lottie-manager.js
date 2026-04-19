/**
 * LottieManager - A standalone functional wrapper for lottie-web.
 * Handles fetching, decompressing (.tgs), rendering, and pausing off-screen animations
 * via IntersectionObserver to save RAM/CPU.
 */
const LottieManager = (function() {
    // CDN links for required libraries if not already loaded
    const LOTTIE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js';
    const PAKO_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';

    let initPromise = null;
    let observer = null;

    // Map to keep track of container elements to their lottie animation instances
    const animationMap = new WeakMap();

    // Helper to dynamically load a script
    function loadScript(url, globalObjectName) {
        return new Promise((resolve, reject) => {
            if (window[globalObjectName]) {
                resolve(window[globalObjectName]);
                return;
            }

            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve(window[globalObjectName]);
            script.onerror = () => reject(new Error(`Failed to load ${url}`));
            document.head.appendChild(script);
        });
    }

    // Initialize the IntersectionObserver
    function initObserver() {
        if (observer) return;

        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const anim = animationMap.get(entry.target);
                if (anim) {
                    if (entry.isIntersecting) {
                        anim.play();
                    } else {
                        anim.pause();
                    }
                }
            });
        }, {
            root: null, // Viewport
            rootMargin: '100px', // Pre-load slightly before coming into view
            threshold: 0.01
        });
    }

    // Initialize dependencies
    function init() {
        if (initPromise) return initPromise;

        initPromise = Promise.all([
            loadScript(LOTTIE_CDN, 'lottie'),
            loadScript(PAKO_CDN, 'pako')
        ]).then(() => {
            initObserver();
        }).catch((error) => {
            console.error('LottieManager initialization failed:', error);
            initPromise = null; // Allow retry
            throw error;
        });

        return initPromise;
    }

    // Fetch and decompress .tgs or .json
    async function fetchAnimationData(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch animation from ${url}`);
        }

        if (url.endsWith('.tgs')) {
            // .tgs files are gzipped JSON
            const arrayBuffer = await response.arrayBuffer();
            const decompressedArray = window.pako.inflate(new Uint8Array(arrayBuffer));
            const decompressedString = new TextDecoder().decode(decompressedArray);
            return JSON.parse(decompressedString);
        } else {
            // Assume .json
            return await response.json();
        }
    }

    // Main API to load an animation into a container
    async function load(container, url, options = {}) {
        if (!container || !url) {
            console.error('LottieManager: container and url are required.');
            return null;
        }

        await init();

        try {
            // Clean up existing animation in this container if any
            const existingAnim = animationMap.get(container);
            if (existingAnim) {
                existingAnim.destroy();
                observer.unobserve(container);
                animationMap.delete(container);
            }

            const animationData = await fetchAnimationData(url);

            const animOptions = {
                container: container,
                renderer: 'svg',
                loop: true,
                autoplay: false, // We control autoplay via IntersectionObserver
                animationData: animationData,
                ...options
            };

            const anim = window.lottie.loadAnimation(animOptions);

            // Store instance and observe container
            animationMap.set(container, anim);
            observer.observe(container);

            return anim;
        } catch (error) {
            console.error('LottieManager: Failed to load animation:', error);
            return null;
        }
    }

    // Destroy an animation and stop observing
    function destroy(container) {
        if (!container) return;

        const anim = animationMap.get(container);
        if (anim) {
            anim.destroy();
            animationMap.delete(container);
            if (observer) {
                observer.unobserve(container);
            }
        }
    }

    return {
        load,
        destroy,
        init
    };
})();

// Export for module systems if needed, else it stays on window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LottieManager;
} else {
    window.LottieManager = LottieManager;
}
