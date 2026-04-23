    // --- MODULE: FORUM ---
    async function loadForum() {
        const container = document.getElementById('forum-list');
        if (!container) return;
        container.innerHTML = '<div class="system-msg">Scanning forum sectors...</div>';
        try {
            const data = await apiRequest('/topics'); 
            container.innerHTML = '';
            if (data.length === 0) {
                container.innerHTML = '<div class="system-msg">No active transmissions found in this sector.</div>';
                return;
            }
            data.forEach(topic => {
                const div = document.createElement('div');
                div.className = 'forum-item';
                div.style.cursor = 'pointer';
                const strong = document.createElement('strong');
                strong.textContent = topic.title;
                const span = document.createElement('span');
                span.className = 'msg-meta';
                span.textContent = `by ${topic.author}`;
                div.appendChild(strong);
                div.appendChild(document.createTextNode(' '));
                div.appendChild(span);
                div.onclick = () => loadTopicPosts(topic.id, topic.title);
                container.appendChild(div);
            });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Unable to synchronize forum data.</div>'; }
    }

    async function loadTopicPosts(topicId, title) {
        const container = document.getElementById('forum-list');
        container.innerHTML = '';
        const sysMsg = document.createElement('div');
        sysMsg.className = 'system-msg';
        sysMsg.textContent = `Accessing thread: ${title}...`;
        container.appendChild(sysMsg);
        try {
            const posts = await apiRequest(`/topics/${topicId}/posts`);
            container.innerHTML = '';
            const h4 = document.createElement('h4');
            h4.textContent = title;
            const backLink = document.createElement('div');
            backLink.className = 'back-link';
            backLink.textContent = '<< Вернуться к списку';
            backLink.onclick = loadForum;
            container.appendChild(h4);
            container.appendChild(backLink);
            posts.forEach(post => {
                const div = document.createElement('div');
                div.className = 'post-item';
                const contentDiv = document.createElement('div');
                contentDiv.className = 'post-content';
                contentDiv.textContent = post.content;

                const metaDiv = document.createElement('div');
                metaDiv.className = 'msg-meta';
                metaDiv.textContent = `by ${post.author} | 👍 `;

                const likesSpan = document.createElement('span');
                likesSpan.id = `likes-${post.id}`;
                likesSpan.textContent = post.likes;

                const btn = document.createElement('button');
                btn.className = 'small-btn';
                btn.textContent = 'Поддержать';
                btn.onclick = () => likePost(post.id);

                metaDiv.appendChild(likesSpan);
                metaDiv.appendChild(document.createTextNode(' '));
                metaDiv.appendChild(btn);

                div.appendChild(contentDiv);
                div.appendChild(metaDiv);
                container.appendChild(div);
            });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Connection lost to this thread.</div>'; }
    }

    window.likePost = async function(postId) {
        try {
            const res = await apiRequest(`/posts/${postId}/like`, 'POST');
            const counter = document.getElementById(`likes-${postId}`);
            if (counter) {
                let current = parseInt(counter.innerText);
                counter.innerText = res.status === 'liked' ? current + 1 : current - 1;
            }
        } catch (e) { console.error("Rating rejected", e); }
    }

    // --- MARKET EVENT LISTENERS ---
    const marketSearchInput = document.getElementById('market-search');
    if (marketSearchInput) {
        marketSearchInput.addEventListener('input', debounce((e) => {
            window.marketState.filters.q = e.target.value;
            window.marketState.page = 1;
            loadMarket();
        }, 300));
    }
    const marketFilterCat = document.getElementById('market-filter-cat');
    if (marketFilterCat) {
        marketFilterCat.addEventListener('change', (e) => {
            window.marketState.filters.cat = e.target.value;
            window.marketState.page = 1;
            loadMarket();
        });
    }
    const marketFilterLoc = document.getElementById('market-filter-loc');
    if (marketFilterLoc) {
        marketFilterLoc.addEventListener('change', (e) => {
            window.marketState.filters.loc = e.target.value;
            window.marketState.page = 1;
            loadMarket();
        });
    }


    // --- MODULE: WIKI ---
    async function loadWiki() {
        const container = document.querySelector('.wiki-content');
        if (!container) return;
        try {
            const articles = await apiRequest('/wiki');
            container.innerHTML = '';
            if (articles.length === 0) {
                container.innerHTML = '<div class="system-msg">LIBRARY_EMPTY: Поиск данных не дал результатов.</div>';
                return;
            }
            articles.forEach(art => {
                const div = document.createElement('div');
                div.className = 'wiki-card';
                const h3 = document.createElement('h3');
                h3.textContent = art.title;

                const metaDiv = document.createElement('div');
                metaDiv.className = 'msg-meta';
                metaDiv.textContent = '👍 ';

                const likesSpan = document.createElement('span');
                likesSpan.id = `wiki-likes-${art.id}`;
                likesSpan.textContent = art.likes || 0;

                const likeBtn = document.createElement('button');
                likeBtn.className = 'small-btn';
                likeBtn.textContent = 'Одобрить';
                likeBtn.onclick = () => likeWiki(art.id);

                metaDiv.appendChild(likesSpan);
                metaDiv.appendChild(document.createTextNode(' '));
                metaDiv.appendChild(likeBtn);

                const p = document.createElement('p');
                p.className = 'wiki-excerpt';
                p.textContent = art.content ? art.content.substring(0, 150) + '...' : 'Контент засекречен';

                const openBtn = document.createElement('button');
                openBtn.className = 'cyber-btn-small';
                openBtn.textContent = 'ОТКРЫТЬ ДАННЫЕ';
                openBtn.onclick = () => loadWikiArticle(art.id);

                div.appendChild(h3);
                div.appendChild(metaDiv);
                div.appendChild(p);
                div.appendChild(openBtn);
                container.appendChild(div);
            });
        } catch (e) {
            container.innerHTML = '<div class="system-msg">ERROR: Wiki access failed.</div>';
        }
    }

    // @ts-ignore
    window.likeWiki = async function(artId) {
        try {
            const res = await apiRequest(`/wiki/${artId}/like`, 'POST');
            const counter = document.getElementById(`wiki-likes-${artId}`);
            if (counter) {
                let current = parseInt(counter.innerText);
                counter.innerText = res.status === 'liked' ? current + 1 : current - 1;
            }
        } catch (e) { console.error("Knowledge validation failed", e); }
    }

    async function loadMarket() {
        const container = document.querySelector('.market-grid');
        if (!container) return;
        
        container.className = 'market-grid ' + (window.marketState.layout === 'list' ? 'market-list-view' : '');
        container.innerHTML = '<div class="system-msg">Scanning trade frequencies...</div>';
        try {
            const params = new URLSearchParams();
            if (window.marketState.filters.cat && window.marketState.filters.cat !== 'Все') {
                params.append('category', window.marketState.filters.cat);
            }
            if (window.marketState.filters.loc && window.marketState.filters.loc !== 'Везде') {
                params.append('location', window.marketState.filters.loc);
            }
            if (window.marketState.filters.q) {
                params.append('q', window.marketState.filters.q);
            }
            if (window.marketState.filters.min) {
                params.append('min_price', window.marketState.filters.min);
            }
            if (window.marketState.filters.max) {
                params.append('max_price', window.marketState.filters.max);
            }
            if (window.marketState.filters.sort) {
                params.append('sort', window.marketState.filters.sort);
            }
            params.append('page', window.marketState.page.toString());

            const data = await apiRequest(`/market?${params.toString()}`);
            const listings = data.items || [];

            container.innerHTML = '';
            if (!listings || listings.length === 0) {
                container.innerHTML = '<div class="system-msg">MARKET_EMPTY: Нет активных лотов на бирже.</div>';
                if(window.renderMarketPagination) window.renderMarketPagination(1, 1);
                return;
            }
            listings.forEach(/** @param {any} item */ item => {
                const div = document.createElement('div');
                div.className = 'market-card interactive';
                
                // Cover image
                let coverImageHtml = '';
                if (item.images && item.images.length > 0) {
                    coverImageHtml = `<img src="${API_BASE_URL}${item.images[0]}" class="market-card-cover" alt="cover">`;
                } else {
                    coverImageHtml = `<div class="market-card-cover placeholder">NO IMAGE</div>`;
                }

                // Status Badge
                let statusBadgeHtml = '';
                if (item.status === 'sold') {
                    statusBadgeHtml = `<span class="status-badge sold">ПРОДАНО</span>`;
                } else if (item.status === 'reserved') {
                    statusBadgeHtml = `<span class="status-badge reserved">В РЕЗЕРВЕ</span>`;
                } else {
                    statusBadgeHtml = `<span class="status-badge active">АКТИВЕН</span>`;
                }

                // Favorite Heart
                const isFav = item.is_favorite ? 'favorited' : '';
                const favHtml = `<span class="favorite-btn ${isFav}" onclick="toggleFavorite(event, ${item.id})">❤️</span>`;

                let deleteButtonHTML = '';
                if (item.seller_id === state.user.id) {
                    deleteButtonHTML = `<button class="btn-danger" style="margin-top: 5px; font-size: 10px; width: 100%" onclick="event.stopPropagation(); deleteMarketListing(${item.id})">УДАЛИТЬ ЛОТ</button>`;
                }

                const imgContainer = document.createElement('div');
                imgContainer.className = 'market-card-image-container';
                imgContainer.innerHTML = coverImageHtml + statusBadgeHtml + favHtml; // Safe: no user text in these HTML strings
                const viewsDiv = document.createElement('div');
                viewsDiv.className = 'views-count';
                viewsDiv.textContent = `👁 ${item.views_count || 0}`;
                imgContainer.appendChild(viewsDiv);

                const bodyDiv = document.createElement('div');
                bodyDiv.className = 'market-body';
                bodyDiv.style.padding = '10px';

                const priceDiv = document.createElement('div');
                priceDiv.className = 'market-price';
                priceDiv.style.fontSize = '16px';
                priceDiv.style.fontWeight = 'bold';
                priceDiv.style.color = 'var(--accent-amber)';
                priceDiv.style.marginBottom = '5px';
                priceDiv.textContent = item.price;

                const h4 = document.createElement('h4');
                h4.style.marginBottom = '5px';
                h4.style.fontSize = '14px';
                h4.textContent = item.title;

                const metaDiv = document.createElement('div');
                metaDiv.style.fontSize = '11px';
                metaDiv.style.color = 'var(--text-dim)';
                metaDiv.style.display = 'flex';
                metaDiv.style.justifyContent = 'space-between';

                const locSpan = document.createElement('span');
                locSpan.textContent = item.location;

                const dateSpan = document.createElement('span');
                dateSpan.textContent = new Date(item.created_at || Date.now()).toLocaleDateString();

                metaDiv.appendChild(locSpan);
                metaDiv.appendChild(dateSpan);

                bodyDiv.appendChild(priceDiv);
                bodyDiv.appendChild(h4);
                bodyDiv.appendChild(metaDiv);

                if (deleteButtonHTML) {
                    const delContainer = document.createElement('div');
                    delContainer.innerHTML = deleteButtonHTML; // Safe HTML
                    while (delContainer.firstChild) {
                        bodyDiv.appendChild(delContainer.firstChild);
                    }
                }

                div.appendChild(imgContainer);
                div.appendChild(bodyDiv);

                div.onclick = () => openListingModal(item.id);
                container.appendChild(div);
            });

            if(window.renderMarketPagination) {
                window.renderMarketPagination(data.page || 1, data.pages || 1);
            }
        } catch (e) {
            container.innerHTML = '<div class="system-msg">ERROR: Не удалось синхронизировать данные биржи.</div>';
        }
    }

    window.renderMarketPagination = function(currentPage, totalPages) {
        let paginationContainer = document.querySelector('.market-pagination');
        if (!paginationContainer) {
            paginationContainer = document.createElement('div');
            paginationContainer.className = 'market-pagination';
            paginationContainer.style.display = 'flex';
            paginationContainer.style.justifyContent = 'center';
            paginationContainer.style.alignItems = 'center';
            paginationContainer.style.gap = '15px';
            paginationContainer.style.marginTop = '20px';

            const viewTrade = document.getElementById('view-trade');
            if(viewTrade) {
                viewTrade.appendChild(paginationContainer);
            }
        }

        paginationContainer.innerHTML = '';

        if (totalPages <= 1) return; // Hide if only 1 page

        const prevBtn = document.createElement('button');
        prevBtn.className = 'cyber-btn-small';
        prevBtn.textContent = 'НАЗАД';
        prevBtn.disabled = currentPage <= 1;
        if(currentPage <= 1) prevBtn.style.opacity = '0.5';
        prevBtn.onclick = () => {
            if (window.marketState.page > 1) {
                window.marketState.page--;
                loadMarket();
            }
        };

        const pageText = document.createElement('span');
        pageText.style.color = 'var(--text-main)';
        pageText.style.fontFamily = 'var(--font-mono)';
        pageText.textContent = `СТРАНИЦА ${currentPage} / ${totalPages}`;

        const nextBtn = document.createElement('button');
        nextBtn.className = 'cyber-btn-small';
        nextBtn.textContent = 'ВПЕРЕД';
        nextBtn.disabled = currentPage >= totalPages;
        if(currentPage >= totalPages) nextBtn.style.opacity = '0.5';
        nextBtn.onclick = () => {
            if (window.marketState.page < totalPages) {
                window.marketState.page++;
                loadMarket();
            }
        };

        paginationContainer.appendChild(prevBtn);
        paginationContainer.appendChild(pageText);
        paginationContainer.appendChild(nextBtn);
    }

    window.toggleFavorite = async function(event, itemId) {
        event.stopPropagation();
        try {
            const res = await apiRequest(`/market/${itemId}/favorite`, 'POST');
            const target = event.currentTarget;
            if (res.status === 'added') {
                target.classList.add('favorited');
                addLog('Лот добавлен в избранное', 'info');
            } else {
                target.classList.remove('favorited');
                addLog('Лот удален из избранного', 'info');
            }
        } catch (e) { console.error("Favorite toggle failed", e); }
    }

    window.openListingModal = async function(itemId) {
        try {
            const item = await apiRequest(`/market/${itemId}`);

            document.getElementById('listing-detail-title').textContent = item.title;
            document.getElementById('listing-detail-price').textContent = item.price;
            document.getElementById('listing-detail-desc').textContent = item.description || 'Нет описания.';

            const statusContainer = document.getElementById('listing-detail-status');
            if (item.seller_id === state.user.id) {
                const select = document.createElement('select');
                select.id = 'modal-status-edit';
                select.className = 'cyber-input';
                select.style.padding = '5px';
                select.style.fontSize = '12px';
                select.style.marginTop = '5px';

                const optActive = document.createElement('option');
                optActive.value = 'active';
                optActive.textContent = 'АКТИВЕН';

                const optReserved = document.createElement('option');
                optReserved.value = 'reserved';
                optReserved.textContent = 'В РЕЗЕРВЕ';

                const optSold = document.createElement('option');
                optSold.value = 'sold';
                optSold.textContent = 'ПРОДАНО';

                select.appendChild(optActive);
                select.appendChild(optReserved);
                select.appendChild(optSold);

                select.value = item.status || 'active';

                select.onchange = async (e) => {
                    try {
                        await apiRequest(`/market/${item.id}/status`, 'PATCH', { status: e.target.value });
                        addLog('Статус лота обновлен', 'success');
                        loadMarket(); // Refresh list in background
                    } catch (err) {
                        addLog('Ошибка при обновлении статуса', 'error');
                        // Revert selection on error
                        select.value = item.status || 'active';
                    }
                };

                statusContainer.innerHTML = 'Статус: ';
                statusContainer.appendChild(select);
            } else {
                let statusText = 'АКТИВЕН';
                if (item.status === 'sold') statusText = 'ПРОДАНО';
                if (item.status === 'reserved') statusText = 'В РЕЗЕРВЕ';
                statusContainer.textContent = `Статус: ${statusText}`;
            }

            const gallery = document.getElementById('listing-detail-gallery');
            gallery.innerHTML = '';
            if (item.images && item.images.length > 0) {
                item.images.forEach(url => {
                    const img = document.createElement('img');
                    img.src = `${API_BASE_URL}${url}`;
                    img.style.width = '100px';
                    img.style.height = '100px';
                    img.style.objectFit = 'cover';
                    img.style.border = '1px solid var(--border-metal)';
                    img.style.cursor = 'pointer';
                    img.onclick = () => window.open(`${API_BASE_URL}${url}`, '_blank');
                    gallery.appendChild(img);
                });
            } else {
                gallery.innerHTML = '<div style="color: var(--text-dim); font-style: italic;">Нет фотографий</div>';
            }

            document.getElementById('listing-detail-message-btn').onclick = () => {
                document.getElementById('listing-detail-modal').style.display = 'none';
                startPrivateChat(item.seller_id);
            };

            const favBtn = document.getElementById('listing-detail-fav-btn');
            favBtn.textContent = item.is_favorite ? 'УБРАТЬ ИЗ ИЗБРАННОГО' : '❤️ В ИЗБРАННОЕ';
            favBtn.onclick = async (e) => {
                await window.toggleFavorite(e, item.id);
                favBtn.textContent = favBtn.classList.contains('favorited') ? 'УБРАТЬ ИЗ ИЗБРАННОГО' : '❤️ В ИЗБРАННОЕ';
            };

            document.getElementById('listing-detail-modal').style.display = 'flex';
        } catch(e) {
            addLog('Не удалось загрузить детали лота', 'error');
        }
    }

    // @ts-ignore
    window.deleteMarketListing = async function(itemId) {
        if (!confirm('Подтверждаете удаление лота?')) return;
        try {
            await apiRequest(`/market/${itemId}`, 'DELETE');
            addLog('Лот снят с биржи', 'success');
            loadMarket();
        } catch(e) {
            addLog('Ошибка при удалении лота', 'error');
        }
    }

    window.loadWikiArticle = async function(artId) {
        try {
            const art = await apiRequest(`/wiki/${artId}`);
            alert(`--- ГИПЕРТЕКСТОВАЯ БАЗА --- \n\n${art.title.toUpperCase()}\n\n${art.content}`);
        } catch (e) { addLog('Article data corrupted', 'error'); }
    }
    
    // @ts-ignore
    window.toggleMarketForm = function() {
        const panel = document.getElementById('market-form-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }

    let uploadedImageUrls = [];

    // --- Market Image Upload ---
    window.uploadMarketImages = async function(files) {
        if (!files || files.length === 0) return;

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        try {
            const token = state.user.token;
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const resp = await fetch(`${API_BASE_URL}/market/upload`, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({detail:'Upload failed'}));
                throw new Error(err.detail || 'Upload failed');
            }

            const data = await resp.json();
            const urls = data.urls || [];

            uploadedImageUrls.push(...urls);
            renderMarketPhotoPreview();
            addLog(`Загружено ${urls.length} фото`, 'success');
        } catch (e) {
            addLog(`Ошибка загрузки фото: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
        }
    }

    function renderMarketPhotoPreview() {
        const previewContainer = document.getElementById('market-photo-preview');
        if (!previewContainer) return;
        previewContainer.innerHTML = '';

        uploadedImageUrls.forEach((url, idx) => {
            const thumbWrap = document.createElement('div');
            thumbWrap.style.position = 'relative';
            thumbWrap.style.width = '60px';
            thumbWrap.style.height = '60px';

            const img = document.createElement('img');
            img.src = `${API_BASE_URL}${url}`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.border = '1px solid var(--border-metal)';

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            delBtn.style.position = 'absolute';
            delBtn.style.top = '-5px';
            delBtn.style.right = '-5px';
            delBtn.style.background = '#ff3333';
            delBtn.style.color = '#fff';
            delBtn.style.border = 'none';
            delBtn.style.borderRadius = '50%';
            delBtn.style.width = '18px';
            delBtn.style.height = '18px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.fontSize = '12px';
            delBtn.style.lineHeight = '18px';
            delBtn.style.textAlign = 'center';
            delBtn.onclick = () => {
                uploadedImageUrls.splice(idx, 1);
                renderMarketPhotoPreview();
            };

            thumbWrap.appendChild(img);
            thumbWrap.appendChild(delBtn);
            previewContainer.appendChild(thumbWrap);
        });
    }

    // Attach listener to file input
    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'market-photos') {
            if (e.target.files) {
                window.uploadMarketImages(e.target.files);
            }
        }
    });

    // @ts-ignore
    window.submitMarketListing = async function() {
        const titleElem = document.getElementById('market-title');
        const priceElem = document.getElementById('market-price');
        const descElem = document.getElementById('market-desc');
        const catElem = document.getElementById('market-cat');
        const locElem = document.getElementById('market-loc');
        
        if (!titleElem || !priceElem || !descElem) return;
        
        // @ts-ignore
        const title = titleElem.value;
        // @ts-ignore
        const price = priceElem.value;
        // @ts-ignore
        const description = descElem.value;
        // @ts-ignore
        const category = catElem?.value || 'Разное';
        // @ts-ignore
        const location = locElem?.value || 'Вся сеть';
        
        if (!title || !price) { addLog('Validation Error: Заполните название и цену', 'error'); return; }
        
        try {
            await apiRequest('/market', 'POST', {
                title,
                price,
                description,
                category,
                location,
                images: uploadedImageUrls
            });
            addLog('Лот успешно опубликован', 'success');
            // @ts-ignore
            titleElem.value = '';
            // @ts-ignore
            priceElem.value = '';
            // @ts-ignore
            descElem.value = '';
            uploadedImageUrls = [];
            renderMarketPhotoPreview();
            const panel = document.getElementById('market-form-panel');
            if (panel) panel.style.display = 'none';
            loadMarket();
        } catch (e) { addLog('Market transaction failed', 'error'); }
    }

    // --- MODULE: REGISTRY ---
    async function loadRegistry() {
        const tableBody = document.getElementById('registry-list');
        if (!tableBody) return;
        try {
            const users = await apiRequest('/registry');
            tableBody.innerHTML = '';
            users.forEach(u => {
                const row = document.createElement('tr');
                const avatarCell = document.createElement('td');
                const avatar = document.createElement('div');
                avatar.className = 'registry-avatar';
                applyAvatarDisplay(avatar, u.avatar_url);
                avatarCell.appendChild(avatar);
                
                const td1 = document.createElement('td');
                const spanId = document.createElement('span');
                spanId.className = 'id-tag';
                spanId.textContent = u.id || '---';
                td1.appendChild(spanId);

                const td2 = document.createElement('td');

                const td3 = document.createElement('td');
                td3.className = 'highlight';
                td3.textContent = u.username;

                const td4 = document.createElement('td');
                const spanRank = document.createElement('span');
                spanRank.className = 'rank-badge';
                spanRank.textContent = u.rank;
                td4.appendChild(spanRank);

                const td5 = document.createElement('td');
                td5.className = 'stat-value';
                td5.textContent = u.karma;

                const td6 = document.createElement('td');
                const chatBtn = document.createElement('button');
                chatBtn.className = 'cyber-btn-small';
                chatBtn.textContent = 'СЕКРЕТНЫЙ ЧАТ';
                chatBtn.onclick = () => startPrivateChat(u.id);
                td6.appendChild(chatBtn);

                row.appendChild(td1);
                row.appendChild(td2);
                row.appendChild(td3);
                row.appendChild(td4);
                row.appendChild(td5);
                row.appendChild(td6);
                row.cells[1].appendChild(avatar);
                tableBody.appendChild(row);
            });
        } catch (e) { tableBody.innerHTML = '<tr><td colspan="6" class="system-msg">ERROR: Registry access denied.</td></tr>'; }
    }

    // @ts-ignore
    window.startPrivateChat = async function(targetId) {
        if (targetId === state.user.id) {
            addLog('Нельзя открыть чат с самим собой', 'error');
            return;
        }
        try {
            addLog('Открываю защищённый канал связи...', 'info');
            // Use the dedicated /chat/private endpoint (get-or-create, no duplicates)
            const room = await apiRequest('/chat/private', 'POST', {
                target_user_id: targetId
            });
            switchView('messages');
            // Refresh room list and then select the new/existing room
            await loadChatRooms();
            const roomInList = state.chat.rooms.find(r => r.id === room.id);
            const roomName = roomInList ? roomInList.name : 'Приватный чат';
            const roomType = roomInList ? roomInList.type : 'private';
            selectChatRoom(room.id, roomName, roomType, targetId);
            addLog('E2EE-Канал установлен', 'success');
        } catch (e) {
            addLog('Не удалось установить соединение', 'error');
            console.error('startPrivateChat error:', e);
        }
    }


    // --- MODULE: EVENTS ---
    async function loadEvents() {
        const container = document.getElementById('events-list');
        if (!container) return;
        try {
            const events = await apiRequest('/events');
            container.innerHTML = '';
            if (!events || events.length === 0) {
                container.innerHTML = '<div class="system-msg">Нет активных событий.</div>';
                return;
            }
            events.forEach(/** @param {any} e */ e => {
                const eventCard = document.createElement('div');
                eventCard.className = 'event-card interactive';
                // @ts-ignore
                const safeDate = e.date ? new Date(e.date).toLocaleDateString() : 'Unknown';
                const dateDiv = document.createElement('div');
                dateDiv.className = 'event-date';
                dateDiv.textContent = safeDate;

                const contentDiv = document.createElement('div');
                contentDiv.className = 'event-content';

                const h4 = document.createElement('h4');
                h4.textContent = e.title;

                const p = document.createElement('p');
                p.textContent = `📍 ${e.location || 'Секретная локация'}`;

                contentDiv.appendChild(h4);
                contentDiv.appendChild(p);

                const actionDiv = document.createElement('div');
                actionDiv.className = 'event-action';
                actionDiv.textContent = '> ДЕТАЛИ';

                eventCard.appendChild(dateDiv);
                eventCard.appendChild(contentDiv);
                eventCard.appendChild(actionDiv);
            eventCard.addEventListener('click', () => showEventDetails(e));
            container.appendChild(eventCard);
        });
        } catch (e) { container.innerHTML = '<div class="system-msg">ERROR: Events sync failed.</div>'; }
    }

    // @ts-ignore
    window.toggleEventForm = function() {
        const panel = document.getElementById('event-form-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }

    // @ts-ignore
    window.submitEvent = async function() {
        const titleElem = document.getElementById('event-title');
        const dateElem = document.getElementById('event-date');
        const locElem = document.getElementById('event-location');
        const descElem = document.getElementById('event-desc');
        if (!titleElem || !dateElem || !locElem || !descElem) return;
        
        // @ts-ignore
        const title = titleElem.value;
        // @ts-ignore
        const event_date = dateElem.value ? new Date(dateElem.value).toISOString() : new Date().toISOString();
        // @ts-ignore
        const location = locElem.value;
        // @ts-ignore
        const description = descElem.value;
        
        if (!title) { addLog('Validation Error: Укажите название', 'error'); return; }
        
        try {
            await apiRequest('/events', 'POST', { title, event_date, location, description });
            addLog('Событие анонсировано', 'success');
            // @ts-ignore
            titleElem.value = '';
            // @ts-ignore
            dateElem.value = '';
            // @ts-ignore
            locElem.value = '';
            // @ts-ignore
            descElem.value = '';
            const panel = document.getElementById('event-form-panel');
            if (panel) panel.style.display = 'none';
            loadEvents();
        } catch (e) { addLog('Event broadcast failed', 'error'); }
    }

    function showEventDetails(event) {
        addLog(`Accessing mission data: ${event.title}`, 'info');
        const details = `
            ЦЕЛЬ: ${event.title}
            ДАТА: ${new Date(event.event_date).toLocaleString()}
            ЛОКАЦИЯ: ${event.location}
            ОПИСАНИЕ: ${event.description || 'Данные засекречены'}
        `;
        alert(details);
    }

    // --- MODULE: DASHBOARD & AVATAR ---
    async function loadDashboard() {
        try {
            const data = await apiRequest('/me');
            state.user.username = data.display_name || data.username;
            state.user.id = data.id;
            
            document.getElementById('dash-id').textContent = data.id || '???';
            document.getElementById('dash-username-display').textContent = data.display_name || data.username;
            document.getElementById('dash-rank').textContent = data.rank;
            document.getElementById('dash-karma').textContent = data.karma;
            document.getElementById('dash-bio').value = data.bio || '';
            document.getElementById('dash-callsign-input').value = data.nickname || data.username;
            
            if (data.avatar_url) {
                const dashAvatar = document.getElementById('dash-avatar');
                applyAvatarDisplay(dashAvatar, data.avatar_url);
            }
            syncSidebar(data);
        } catch (e) {
            addLog('Failed to load personnel file', 'error');
        }
    }

    /** @param {any} data */
    function syncSidebar(data) {
        const sidebarName = document.querySelector('.side-panel .username');
        const sidebarRank = document.querySelector('.side-panel .rank');
        const sidebarAvatar = document.querySelector('.side-panel .avatar-placeholder');
        
        if (sidebarName) sidebarName.textContent = `Оператор: ${data.display_name || data.username}`;
        if (sidebarRank) sidebarRank.textContent = data.rank;
        if (sidebarAvatar && data.avatar_url) {
            applyAvatarDisplay(sidebarAvatar, data.avatar_url);
        }
    }

    // --- ДЕЙСТВИЯ: ЛИЧНЫЙ КАБИНЕТ ---
    window.saveProfile = async function() {
        const bioEl = document.getElementById('dash-bio');
        const callsignEl = document.getElementById('dash-callsign-input');
        if (!bioEl || !callsignEl) return;
        
        try {
            // @ts-ignore
            const bio = bioEl.value;
            // @ts-ignore
            const nickname = callsignEl.value;
            
            const result = await apiRequest('/me/update', 'POST', { bio, nickname });
            if (result && result.display_name) {
                state.user.username = result.display_name;
                const display = document.getElementById('dash-username-display');
                if (display) display.textContent = result.display_name;
                addLog('Личное дело успешно обновлено ✅', 'success');
                loadDashboard(); // Refresh everything
            }
        } catch (e) {
            console.error('Profile update error:', e);
            addLog('Не удалось обновить профиль (возможно, позывной занят)', 'error');
        }
    }

    window.openAvatarModal = function() {
        const modal = document.getElementById('avatar-modal');
        const grid = document.getElementById('avatar-selector-grid');
        if (!modal || !grid) return;
        
        grid.innerHTML = '';
        
        // 35 Heroes mapped to 4 full 3x3 sheets and 8 characters from 5th sheet
        for (let i = 0; i < 35; i++) {
            const setNum = Math.floor(i / 9) + 1;
            const idxInSet = i % 9;
            const url = `SPRITE:assets/avatars/set_${setNum}.png:${idxInSet}`;
            
            const btn = document.createElement('div');
            btn.className = 'avatar-option';
            btn.style.width = '80px';
            btn.style.height = '80px';
            btn.style.border = '2px solid var(--neon-cyan)';
            btn.style.cursor = 'pointer';
            
            applyAvatarDisplay(btn, url);
            btn.onclick = () => {
                window.selectAvatar(url);
            };
            grid.appendChild(btn);
        }

        modal.style.display = 'flex';
        playSound('click');
    }

    window.closeAvatarModal = function() {
        const modal = document.getElementById('avatar-modal');
        if (modal) modal.style.display = 'none';
    }

    window.selectAvatar = async function(url) {
        try {
            await apiRequest('/me/update', 'POST', { avatar_url: url });
            const dashAvatar = document.getElementById('dash-avatar');
            if (dashAvatar) applyAvatarDisplay(dashAvatar, url);
            
            addLog('Аватар обновлен: Канал связи активен ✅', 'success');
            window.closeAvatarModal();
            loadDashboard(); // Refresh UI
        } catch (e) {
            addLog('Ошибка синхронизации канала аватара', 'error');
        }
    }

    window.useCustomAvatar = function() {
        const input = document.getElementById('custom-avatar-url');
        // @ts-ignore
        if (input && input.value) {
            // @ts-ignore
            window.selectAvatar(input.value);
        }
    }


