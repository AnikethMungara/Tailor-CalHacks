import pytest

from app.tools import host_matches, run_test

SNAPSHOT = (
    "<div id='app'><a class='short' href='/shorts/1'>s1</a>"
    "<a class='short' href='/shorts/2'>s2</a><div class='video'>keep</div></div>"
)


def test_host_matches_strips_www():
    assert host_matches("https://www.youtube.com/watch?v=x") == ["*://*.youtube.com/*"]
    assert host_matches("https://mail.google.com/mail/u/0") == ["*://*.mail.google.com/*"]


def test_host_matches_fallback():
    assert host_matches("not a url") == ["*://*/*"]


async def _chromium_ok() -> bool:
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            b = await p.chromium.launch(headless=True)
            await b.close()
        return True
    except Exception:
        return False


@pytest.mark.asyncio
async def test_run_test_valid_script_passes():
    if not await _chromium_ok():
        pytest.skip("Playwright chromium not installed")
    css = ".short{display:none}"
    js = "document.querySelectorAll('.short').forEach(e => e.remove());"
    result = await run_test(SNAPSHOT, css, js)
    assert result.ok, result.errors


@pytest.mark.asyncio
async def test_run_test_broken_script_fails():
    if not await _chromium_ok():
        pytest.skip("Playwright chromium not installed")
    js = "document.querySelectorAll('.short').forEach(e => e.notAMethod());"
    result = await run_test(SNAPSHOT, "", js)
    assert not result.ok
    assert result.errors
