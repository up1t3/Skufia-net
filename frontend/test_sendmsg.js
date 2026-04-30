/**
 * Node.js unit tests for sendChatMsg pipeline
 * Extracts and tests the core logic without browser DOM
 */

let passed = 0, failed = 0;

function assert(condition, name) {
    if (condition) {
        passed++;
        console.log(`  ✅ PASS: ${name}`);
    } else {
        failed++;
        console.log(`  ❌ FAIL: ${name}`);
    }
}

// ========================================
// MOCK ENVIRONMENT
// ========================================
const state = {
    user: { id: 1, username: 'testuser', display_name: 'Test User', token: 'fake-token' },
    chat: {
        currentRoomId: 42,
        currentRoomType: 'group',
        receiverId: 2,
        replyToId: null,
        editingId: null,
        sessionKeys: {},
        socket: null
    },
    pendingFile: null
};

// Mock input element
class MockInput {
    constructor() { this.value = ''; this.dataset = { sending: 'false' }; this._focused = false; }
    focus() { this._focused = true; }
    trim() { return this.value.trim(); }
}

// Mock DOM
const mockElements = {};
function resetDOM() {
    mockElements['chat-input'] = new MockInput();
    mockElements['chat-history'] = { children: [], innerHTML: '', appendChild(el) { this.children.push(el); } };
    mockElements['edit-banner'] = { style: { display: '' } };
}

function getElementById(id) {
    if (id.startsWith('msg-')) {
        // Find in chat-history children
        const history = mockElements['chat-history'];
        if (history) {
            return history.children.find(c => c.id === id) || null;
        }
        return null;
    }
    return mockElements[id] || null;
}

// Mock API
let lastApiCall = null;
let apiShouldFail = false;
async function mockApiRequest(endpoint, method, body) {
    lastApiCall = { endpoint, method, body };
    if (apiShouldFail) throw new Error('Network error');
    return { id: 9999, ok: true };
}

function clearChatFile() { state.pendingFile = null; }

// Mock renderChatMessage
function renderChatMessage(msg) {
    const history = mockElements['chat-history'];
    if (!history) return;
    const el = { id: `msg-${msg.id}`, textContent: msg.text || msg.content || '', remove() {
        const idx = history.children.indexOf(this);
        if (idx > -1) history.children.splice(idx, 1);
    }};
    history.children.push(el);
}

// ========================================
// EXTRACTED sendChatMsg (mirrors production code exactly)
// ========================================
async function sendChatMsg(directCaption = null) {
    const input = getElementById('chat-input');
    
    let content = (typeof directCaption === 'string') ? directCaption : (input ? input.value.trim() : '');
    const hasContent = !!content.trim();
    const hasFile = !!state.pendingFile;
    
    if (state.chat.currentRoomId == null || (!hasContent && !hasFile)) {
        return 'SKIPPED_NO_CONTENT';
    }

    // Prevent double sending
    if (input && input.dataset.sending === 'true' && typeof directCaption !== 'string') return 'SKIPPED_DOUBLE_SEND';
    if (input) {
        input.dataset.sending = 'true';
    }

    const roomId = state.chat.currentRoomId;
    let savedContent = content;
    let savedFile = state.pendingFile ? { ...state.pendingFile } : null;
    let savedReplyId = state.chat.replyToId;
    let optimisticId = Date.now();

    let payload = {
        content,
        encryption_iv: '',
        file_url: state.pendingFile ? state.pendingFile.url : null,
        reply_to_id: state.chat.replyToId
    };

    let sendSucceeded = false;
    try {
        let isEncrypted = false;
        // E2EE skipped for group chats

        savedContent = content;
        savedFile = state.pendingFile ? { ...state.pendingFile } : null;
        savedReplyId = state.chat.replyToId;

        // OPTIMISTIC RENDER
        if (input) input.value = '';
        clearChatFile();

        optimisticId = Date.now();
        if (!state.chat.editingId) {
            const optimisticMsg = {
                id: optimisticId,
                sender: state.user?.username || 'Я',
                sender_id: state.user?.id,
                text: savedContent,
                content: savedContent,
                iv: null,
                is_secure: false,
                file_url: savedFile ? savedFile.url : null,
                reply_to_id: savedReplyId,
                is_edited: false,
                is_read: false,
                timestamp: new Date().toISOString()
            };
            renderChatMessage(optimisticMsg);
        }

        // API REQUEST
        let response;
        if (state.chat.editingId) {
            response = await mockApiRequest(`/chat/messages/${state.chat.editingId}`, 'PUT', payload);
            state.chat.editingId = null;
        } else {
            response = await mockApiRequest(`/chat/rooms/${roomId}/send`, 'POST', payload);
            const tempMsgEl = getElementById(`msg-${optimisticId}`);
            if (tempMsgEl && response && response.id) {
                tempMsgEl.id = `msg-${response.id}`;
            }
        }
        
        sendSucceeded = true;
    } catch (e) {
        if (input) input.value = savedContent;
        if (savedFile) state.pendingFile = savedFile;
        if (!state.chat.editingId) {
            const tempMsgEl = getElementById(`msg-${optimisticId}`);
            if (tempMsgEl) tempMsgEl.remove();
        }
    } finally {
        if (input) {
            input.dataset.sending = 'false';
            if (sendSucceeded) {
                input.value = '';
            }
            input.focus();
        }
    }
    return sendSucceeded ? 'SUCCESS' : 'FAILED';
}

// ========================================
// TEST SUITE
// ========================================
function resetState() {
    resetDOM();
    lastApiCall = null;
    apiShouldFail = false;
    state.chat.currentRoomId = 42;
    state.chat.currentRoomType = 'group';
    state.chat.editingId = null;
    state.chat.replyToId = null;
    state.pendingFile = null;
}

async function runTests() {
    console.log('\n🧪 sendChatMsg Pipeline Tests\n');
    console.log('════════════════════════════════════════');

    // T1: Basic send
    console.log('\n--- T1: Basic message send ---');
    resetState();
    mockElements['chat-input'].value = 'Привет мир';
    const r1 = await sendChatMsg();
    assert(r1 === 'SUCCESS', 'Basic send returns SUCCESS');
    assert(lastApiCall !== null, 'API was called');
    assert(lastApiCall.endpoint === '/chat/rooms/42/send', 'Correct endpoint');
    assert(lastApiCall.method === 'POST', 'Correct method');
    assert(lastApiCall.body.content === 'Привет мир', 'Correct content');
    assert(mockElements['chat-input'].value === '', 'Input cleared');
    assert(mockElements['chat-input'].dataset.sending === 'false', 'sending flag reset');
    assert(mockElements['chat-history'].children.length === 1, 'Optimistic msg rendered');

    // T2: Empty message blocked
    console.log('\n--- T2: Empty message blocked ---');
    resetState();
    mockElements['chat-input'].value = '';
    const r2 = await sendChatMsg();
    assert(r2 === 'SKIPPED_NO_CONTENT', 'Empty message skipped');
    assert(lastApiCall === null, 'No API call');
    assert(mockElements['chat-history'].children.length === 0, 'No optimistic msg');

    // T3: Whitespace-only blocked
    console.log('\n--- T3: Whitespace-only blocked ---');
    resetState();
    mockElements['chat-input'].value = '   ';
    const r3 = await sendChatMsg();
    assert(r3 === 'SKIPPED_NO_CONTENT', 'Whitespace-only skipped');

    // T4: No room selected
    console.log('\n--- T4: No room selected ---');
    resetState();
    mockElements['chat-input'].value = 'Test';
    state.chat.currentRoomId = null;
    const r4 = await sendChatMsg();
    assert(r4 === 'SKIPPED_NO_CONTENT', 'No room → skipped');
    assert(lastApiCall === null, 'No API call');

    // T5: Double send prevention
    console.log('\n--- T5: Double send prevention ---');
    resetState();
    mockElements['chat-input'].value = 'Первое';
    mockElements['chat-input'].dataset.sending = 'true';
    const r5 = await sendChatMsg();
    assert(r5 === 'SKIPPED_DOUBLE_SEND', 'Double send blocked');
    assert(lastApiCall === null, 'No API call on double send');

    // T6: directCaption as string
    console.log('\n--- T6: directCaption string ---');
    resetState();
    const r6 = await sendChatMsg('Прямой текст');
    assert(r6 === 'SUCCESS', 'directCaption string works');
    assert(lastApiCall.body.content === 'Прямой текст', 'Correct content from caption');

    // T7: directCaption bypasses double-send guard
    console.log('\n--- T7: directCaption bypasses sending guard ---');
    resetState();
    mockElements['chat-input'].dataset.sending = 'true';
    const r7 = await sendChatMsg('Голосовое');
    assert(r7 === 'SUCCESS', 'directCaption bypasses sending guard');

    // T8: MouseEvent as directCaption → falls back to input.value
    console.log('\n--- T8: MouseEvent as directCaption ---');
    resetState();
    mockElements['chat-input'].value = 'Из инпута';
    const fakeEvent = { type: 'click', target: {} }; // simulated MouseEvent
    const r8 = await sendChatMsg(fakeEvent);
    assert(r8 === 'SUCCESS', 'MouseEvent arg → SUCCESS (falls back to input)');
    assert(lastApiCall.body.content === 'Из инпута', 'Content from input, not event');

    // T9: Optimistic ID updated to server ID
    console.log('\n--- T9: Optimistic ID → server ID ---');
    resetState();
    mockElements['chat-input'].value = 'ID тест';
    await sendChatMsg();
    assert(mockElements['chat-history'].children.length === 1, 'One msg rendered');
    assert(mockElements['chat-history'].children[0].id === 'msg-9999', 'ID updated to server ID 9999');

    // T10: API failure restores input
    console.log('\n--- T10: API failure restores input ---');
    resetState();
    mockElements['chat-input'].value = 'Ошибка сети';
    apiShouldFail = true;
    const r10 = await sendChatMsg();
    assert(r10 === 'FAILED', 'API error → FAILED');
    assert(mockElements['chat-input'].value === 'Ошибка сети', 'Input restored on error');
    assert(mockElements['chat-history'].children.length === 0, 'Optimistic msg removed');
    assert(mockElements['chat-input'].dataset.sending === 'false', 'sending flag reset');

    // T11: File-only message
    console.log('\n--- T11: File-only (no text) ---');
    resetState();
    mockElements['chat-input'].value = '';
    state.pendingFile = { url: '/uploads/photo.jpg', name: 'photo.jpg' };
    const r11 = await sendChatMsg();
    assert(r11 === 'SUCCESS', 'File-only sends');
    assert(lastApiCall.body.file_url === '/uploads/photo.jpg', 'File URL in payload');
    assert(lastApiCall.body.content === '', 'Content is empty for file-only');

    // T12: directCaption=null with no input → SKIP
    console.log('\n--- T12: directCaption=null, empty input ---');
    resetState();
    mockElements['chat-input'].value = '';
    const r12 = await sendChatMsg(null);
    assert(r12 === 'SKIPPED_NO_CONTENT', 'null directCaption + empty → skipped');

    // T13: After successful send, can send again (flag properly reset)
    console.log('\n--- T13: Sequential sends work ---');
    resetState();
    mockElements['chat-input'].value = 'Первое';
    await sendChatMsg();
    assert(mockElements['chat-input'].dataset.sending === 'false', 'Flag reset after 1st send');
    // Now send second message
    mockElements['chat-input'].value = 'Второе';
    lastApiCall = null;
    const r13 = await sendChatMsg();
    assert(r13 === 'SUCCESS', 'Second send works');
    assert(lastApiCall.body.content === 'Второе', 'Second message content correct');

    // ==============================
    // SUMMARY
    // ==============================
    console.log('\n════════════════════════════════════════');
    console.log(`ИТОГО: ${passed + failed} тестов | ✅ ${passed} | ❌ ${failed}`);
    console.log('════════════════════════════════════════\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error('Test runner error:', e); process.exit(1); });
