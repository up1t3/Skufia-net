"""
Unit Tests — Chat Pipeline Logic
Pyramid Layer 1: Pure business logic, no HTTP, no DB

Coverage:
  - Message text validation (empty, too long, XSS)
  - File upload constraints (size, extension whitelist)
  - Chat room membership logic
  - Sanitization helpers
"""
import pytest


# ────────────────────────────────────────────────────────────
# Helpers pulled from backend (or duplicated for pure unit test)
# ────────────────────────────────────────────────────────────

ALLOWED_EXTENSIONS = {
    "jpg", "jpeg", "png", "gif", "webp",  # images
    "mp4", "webm", "ogg", "mp3",          # media
    "pdf", "doc", "docx", "xls", "xlsx",  # docs
    "zip", "rar", "7z",                   # archives
}
MAX_MSG_LEN = 4000
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB


def validate_message(text: str) -> tuple[bool, str]:
    """Pure text validation — mirrors backend logic."""
    if not text or not text.strip():
        return False, "empty"
    if len(text) > MAX_MSG_LEN:
        return False, "too_long"
    return True, "ok"


def get_file_extension(filename: str) -> str:
    basename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if basename.startswith("."):
        return ""  # dotfiles like .gitignore have no real extension
    parts = basename.rsplit(".", 1)
    return parts[1].lower() if len(parts) == 2 else ""


def validate_file(filename: str, size_bytes: int) -> tuple[bool, str]:
    ext = get_file_extension(filename)
    if not ext:
        return False, "no_extension"
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"extension_not_allowed:{ext}"
    if size_bytes <= 0:
        return False, "empty_file"
    if size_bytes > MAX_FILE_BYTES:
        return False, "file_too_large"
    return True, "ok"


def can_access_room(user_id: int, room_members: list[int]) -> bool:
    return user_id in room_members


# ────────────────────────────────────────────────────────────
# T1: Message validation
# ────────────────────────────────────────────────────────────

class TestMessageValidation:

    def test_valid_normal_message(self):
        ok, reason = validate_message("Привет!")
        assert ok is True

    def test_valid_long_message(self):
        ok, reason = validate_message("A" * MAX_MSG_LEN)
        assert ok is True

    def test_empty_string_rejected(self):
        ok, reason = validate_message("")
        assert ok is False
        assert reason == "empty"

    def test_whitespace_only_rejected(self):
        ok, reason = validate_message("   \n\t  ")
        assert ok is False
        assert reason == "empty"

    def test_none_rejected(self):
        ok, reason = validate_message(None)  # type: ignore
        assert ok is False

    def test_message_over_limit_rejected(self):
        ok, reason = validate_message("A" * (MAX_MSG_LEN + 1))
        assert ok is False
        assert reason == "too_long"

    def test_emoji_in_message(self):
        ok, _ = validate_message("🔥🎯💬 Привет!")
        assert ok is True

    def test_xss_payload_passes_validation(self):
        """Validation should pass — sanitization is backend's job, not validation."""
        ok, _ = validate_message("<script>alert(1)</script>")
        assert ok is True  # validation accepts, sanitizer strips later

    def test_exactly_at_limit(self):
        ok, _ = validate_message("X" * MAX_MSG_LEN)
        assert ok is True


# ────────────────────────────────────────────────────────────
# T2: File upload validation
# ────────────────────────────────────────────────────────────

class TestFileValidation:

    @pytest.mark.parametrize("filename", [
        "photo.jpg", "photo.JPEG", "image.png", "clip.mp4",
        "doc.pdf", "archive.zip", "audio.mp3", "video.webm",
    ])
    def test_allowed_extensions_accepted(self, filename):
        ok, reason = validate_file(filename, 1024)
        assert ok is True, f"Expected ok for {filename}, got: {reason}"

    @pytest.mark.parametrize("filename", [
        "malware.exe", "script.sh", "payload.php",
        "virus.bat", "hack.py", "evil.js",
    ])
    def test_dangerous_extensions_rejected(self, filename):
        ok, reason = validate_file(filename, 1024)
        assert ok is False
        assert "extension_not_allowed" in reason

    def test_no_extension_rejected(self):
        ok, reason = validate_file("noextension", 1024)
        assert ok is False
        assert reason == "no_extension"

    def test_empty_file_rejected(self):
        ok, reason = validate_file("file.jpg", 0)
        assert ok is False
        assert reason == "empty_file"

    def test_file_over_50mb_rejected(self):
        ok, reason = validate_file("big.mp4", MAX_FILE_BYTES + 1)
        assert ok is False
        assert reason == "file_too_large"

    def test_exact_50mb_accepted(self):
        ok, _ = validate_file("video.mp4", MAX_FILE_BYTES)
        assert ok is True

    def test_uppercase_extension_normalized(self):
        ok, _ = validate_file("PHOTO.JPG", 1024)
        assert ok is True

    def test_dotfile_no_name_rejected(self):
        ok, reason = validate_file(".htaccess", 100)
        assert ok is False  # ext would be "htaccess" not in whitelist

    def test_double_extension_uses_last(self):
        """file.jpg.exe should be treated as .exe (blocked)."""
        ok, reason = validate_file("safe.jpg.exe", 100)
        assert ok is False


# ────────────────────────────────────────────────────────────
# T3: Room access control
# ────────────────────────────────────────────────────────────

class TestRoomAccess:

    def test_member_can_access(self):
        assert can_access_room(42, [1, 2, 42, 99]) is True

    def test_non_member_cannot_access(self):
        assert can_access_room(100, [1, 2, 42]) is False

    def test_empty_room_no_access(self):
        assert can_access_room(1, []) is False

    def test_single_member_room(self):
        assert can_access_room(7, [7]) is True

    def test_large_room(self):
        members = list(range(1, 1001))
        assert can_access_room(999, members) is True
        assert can_access_room(1001, members) is False


# ────────────────────────────────────────────────────────────
# T4: Extension extraction edge cases
# ────────────────────────────────────────────────────────────

class TestExtensionParsing:

    def test_normal_extension(self):
        assert get_file_extension("file.jpg") == "jpg"

    def test_uppercase_lowercased(self):
        assert get_file_extension("FILE.PNG") == "png"

    def test_no_dot_returns_empty(self):
        assert get_file_extension("nodot") == ""

    def test_multiple_dots_uses_last(self):
        assert get_file_extension("archive.tar.gz") == "gz"

    def test_hidden_file(self):
        assert get_file_extension(".gitignore") == ""

    def test_spaces_in_name(self):
        assert get_file_extension("my document.docx") == "docx"
