// Lightbox with Pinch-to-Zoom support

document.addEventListener('DOMContentLoaded', () => {
    // Inject Lightbox HTML if it doesn't exist
    if (!document.getElementById('lightbox-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'lightbox-overlay';
        overlay.className = 'lightbox-overlay';
        overlay.innerHTML = `
            <button class="lightbox-close" id="lightbox-close">&times;</button>
            <img id="lightbox-img" class="lightbox-content" src="" alt="Zoomed view">
        `;
        document.body.appendChild(overlay);
        
        const closeBtn = document.getElementById('lightbox-close');
        closeBtn.addEventListener('click', closeLightbox);
        
        // Close on background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeLightbox();
            }
        });
        
        // Setup Pinch-to-zoom
        setupPinchToZoom(document.getElementById('lightbox-img'));
    }
});

function openLightbox(event, url) {
    event.preventDefault();
    const overlay = document.getElementById('lightbox-overlay');
    const img = document.getElementById('lightbox-img');
    if (overlay && img) {
        img.src = url;
        img.style.transform = 'scale(1)'; // reset scale
        overlay.classList.add('active');
    }
}
window.openLightbox = openLightbox;

function closeLightbox() {
    const overlay = document.getElementById('lightbox-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        const img = document.getElementById('lightbox-img');
        if (img) img.style.transform = 'scale(1)';
    }
}
window.closeLightbox = closeLightbox;

function setupPinchToZoom(imgElement) {
    if (!imgElement) return;
    
    let currentScale = 1;
    let initialDistance = 0;
    
    imgElement.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            initialDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
        }
    });
    
    imgElement.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const currentDistance = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            
            const scaleChange = currentDistance / initialDistance;
            currentScale = Math.min(Math.max(1, currentScale * scaleChange), 5); // limit scale 1x - 5x
            
            if (imgElement) {
                imgElement.style.transform = `scale(${currentScale})`;
                imgElement.style.cursor = currentScale > 1 ? 'grab' : 'auto';
            }
            initialDistance = currentDistance; // reset for continuous smooth scaling
        }
    });
    
    // Reset on touchend
    imgElement.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            // Option to snap back or keep scaled. Let's keep scaled but allow double tap to reset?
            // For simplicity, keep it scaled.
        }
    });
}
