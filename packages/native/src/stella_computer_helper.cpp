// stella-computer-helper.exe - Windows UI Automation + Win32 bridge for Stella.
// Usage: stella-computer-helper.exe <operation.json>

#define NOMINMAX
#include <windows.h>
#include <UIAutomationClient.h>
#include <dwmapi.h>
#include <gdiplus.h>
#include <oleacc.h>
#include <objidl.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <tlhelp32.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "oleacc.lib")

#ifndef PW_RENDERFULLCONTENT
#define PW_RENDERFULLCONTENT 0x00000002
#endif

// An error with a stable machine-readable code next to its message. The
// runtime maps the code to a specific error for the agent (input refused,
// UIPI, focus refused, ...) instead of a generic helper failure.
struct CodedError : public std::runtime_error {
    std::string code;
    CodedError(const std::string& errorCode, const std::string& message)
        : std::runtime_error(message), code(errorCode) {}
};

static std::string win32ErrorText(DWORD error) {
    if (error == 0) return "Windows reported no error code";
    char* buffer = nullptr;
    DWORD size = FormatMessageA(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        NULL, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPSTR)&buffer, 0, NULL);
    std::string text = size && buffer ? std::string(buffer, size) : "";
    if (buffer) LocalFree(buffer);
    while (!text.empty() && (text.back() == '\r' || text.back() == '\n' || text.back() == ' ' || text.back() == '.')) {
        text.pop_back();
    }
    const char* name = nullptr;
    switch (error) {
    case ERROR_ACCESS_DENIED: name = "ERROR_ACCESS_DENIED"; break;
    case ERROR_INVALID_PARAMETER: name = "ERROR_INVALID_PARAMETER"; break;
    case ERROR_INVALID_WINDOW_HANDLE: name = "ERROR_INVALID_WINDOW_HANDLE"; break;
    case ERROR_NOT_ENOUGH_QUOTA: name = "ERROR_NOT_ENOUGH_QUOTA"; break;
    case ERROR_TIMEOUT: name = "ERROR_TIMEOUT"; break;
    default: break;
    }
    std::ostringstream out;
    out << "error " << error;
    if (name) out << " " << name;
    if (!text.empty()) out << ": " << text;
    return out.str();
}

struct ComInit {
    bool ok = false;
    ComInit() {
        HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
        ok = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
    }
    ~ComInit() {
        if (ok) CoUninitialize();
    }
};

template <typename T>
static void safeRelease(T*& ptr) {
    if (ptr) {
        ptr->Release();
        ptr = nullptr;
    }
}

static std::wstring toWide(const std::string& s) {
    if (s.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), NULL, 0);
    if (len <= 0) return L"";
    std::wstring out(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &out[0], len);
    return out;
}

static std::string toUtf8(const std::wstring& ws) {
    if (ws.empty()) return "";
    int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), NULL, 0, NULL, NULL);
    if (len <= 0) return "";
    std::string out(len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), &out[0], len, NULL, NULL);
    return out;
}

static std::wstring bstrToWstring(BSTR bstr) {
    if (!bstr) return L"";
    return std::wstring(bstr, SysStringLen(bstr));
}

static std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 16);
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out.push_back((char)c);
            }
            break;
        }
    }
    return out;
}

static std::string jsonString(const std::string& s) {
    return "\"" + jsonEscape(s) + "\"";
}

struct Json {
    enum Type { Null, Bool, Number, String, Array, Object } type = Null;
    bool boolValue = false;
    double numberValue = 0;
    std::string stringValue;
    std::vector<Json> arrayValue;
    std::map<std::string, Json> objectValue;

    const Json* get(const std::string& key) const {
        if (type != Object) return nullptr;
        auto it = objectValue.find(key);
        return it == objectValue.end() ? nullptr : &it->second;
    }
    std::string str(const std::string& key, const std::string& fallback = "") const {
        const Json* value = get(key);
        return value && value->type == String ? value->stringValue : fallback;
    }
    double num(const std::string& key, double fallback = 0) const {
        const Json* value = get(key);
        return value && value->type == Number ? value->numberValue : fallback;
    }
};

struct JsonParser {
    const std::string& s;
    size_t i = 0;

    explicit JsonParser(const std::string& input) : s(input) {}

    void skipWs() {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
    }

    bool consume(char c) {
        skipWs();
        if (i < s.size() && s[i] == c) {
            i++;
            return true;
        }
        return false;
    }

    static void appendUtf8(std::string& out, unsigned codepoint) {
        if (codepoint <= 0x7f) {
            out.push_back((char)codepoint);
        } else if (codepoint <= 0x7ff) {
            out.push_back((char)(0xc0 | (codepoint >> 6)));
            out.push_back((char)(0x80 | (codepoint & 0x3f)));
        } else {
            out.push_back((char)(0xe0 | (codepoint >> 12)));
            out.push_back((char)(0x80 | ((codepoint >> 6) & 0x3f)));
            out.push_back((char)(0x80 | (codepoint & 0x3f)));
        }
    }

    std::string parseStringRaw() {
        std::string out;
        if (!consume('"')) return out;
        while (i < s.size()) {
            char c = s[i++];
            if (c == '"') break;
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (i >= s.size()) break;
            char esc = s[i++];
            switch (esc) {
            case '"': out.push_back('"'); break;
            case '\\': out.push_back('\\'); break;
            case '/': out.push_back('/'); break;
            case 'b': out.push_back('\b'); break;
            case 'f': out.push_back('\f'); break;
            case 'n': out.push_back('\n'); break;
            case 'r': out.push_back('\r'); break;
            case 't': out.push_back('\t'); break;
            case 'u': {
                unsigned cp = 0;
                for (int n = 0; n < 4 && i < s.size(); n++, i++) {
                    char h = s[i];
                    cp <<= 4;
                    if (h >= '0' && h <= '9') cp += h - '0';
                    else if (h >= 'a' && h <= 'f') cp += h - 'a' + 10;
                    else if (h >= 'A' && h <= 'F') cp += h - 'A' + 10;
                }
                appendUtf8(out, cp);
                break;
            }
            default:
                out.push_back(esc);
                break;
            }
        }
        return out;
    }

    Json parseValue() {
        skipWs();
        if (i >= s.size()) return {};
        if (s[i] == '"') {
            Json v;
            v.type = Json::String;
            v.stringValue = parseStringRaw();
            return v;
        }
        if (s[i] == '{') return parseObject();
        if (s[i] == '[') return parseArray();
        if (s.compare(i, 4, "true") == 0) {
            i += 4;
            Json v;
            v.type = Json::Bool;
            v.boolValue = true;
            return v;
        }
        if (s.compare(i, 5, "false") == 0) {
            i += 5;
            Json v;
            v.type = Json::Bool;
            return v;
        }
        if (s.compare(i, 4, "null") == 0) {
            i += 4;
            return {};
        }
        return parseNumber();
    }

    Json parseNumber() {
        skipWs();
        size_t start = i;
        if (i < s.size() && s[i] == '-') i++;
        while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;
        if (i < s.size() && s[i] == '.') {
            i++;
            while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;
        }
        if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
            i++;
            if (i < s.size() && (s[i] == '+' || s[i] == '-')) i++;
            while (i < s.size() && s[i] >= '0' && s[i] <= '9') i++;
        }
        Json v;
        v.type = Json::Number;
        v.numberValue = atof(s.substr(start, i - start).c_str());
        return v;
    }

    Json parseArray() {
        Json v;
        v.type = Json::Array;
        consume('[');
        skipWs();
        if (consume(']')) return v;
        while (i < s.size()) {
            v.arrayValue.push_back(parseValue());
            skipWs();
            if (consume(']')) break;
            consume(',');
        }
        return v;
    }

    Json parseObject() {
        Json v;
        v.type = Json::Object;
        consume('{');
        skipWs();
        if (consume('}')) return v;
        while (i < s.size()) {
            std::string key = parseStringRaw();
            consume(':');
            v.objectValue[key] = parseValue();
            skipWs();
            if (consume('}')) break;
            consume(',');
        }
        return v;
    }
};

struct Frame {
    double x = 0, y = 0, width = 0, height = 0;
    bool present = false;
};

struct ElementRecord {
    int index = -1;
    std::vector<int> runtimeId;
    std::wstring automationId;
    std::wstring name;
    std::wstring controlType;
    std::wstring localizedControlType;
    std::wstring className;
    std::wstring value;
    long long nativeWindowHandle = 0;
    Frame frame;
    std::vector<std::string> actions;
};

struct WindowProcess {
    HWND hwnd = NULL;
    DWORD pid = 0;
    std::wstring processName;
    std::wstring title;
};

struct Snapshot {
    std::wstring appName;
    DWORD pid = 0;
    long long windowId = 0;
    std::wstring windowTitle;
    Frame windowBounds;
    std::string screenshotBase64;
    std::vector<std::string> treeLines;
    std::wstring focusedSummary;
    std::wstring selectedText;
    std::vector<ElementRecord> elements;
    std::vector<std::string> warnings;
    std::string captureMethod;
    bool captureOccluded = false;
    bool captureBlank = false;
    std::string surfaceKind;
    std::string framework;
    bool surfaceFullscreen = false;
    bool surfaceMinimized = false;
    int contentElementCount = -1;
    std::string accessibilityWake;
    int screenshotWidth = 0;
    int screenshotHeight = 0;
    std::string appInstructions;
    unsigned long long revision = 0;
    unsigned long long materializedRevision = 0;
    bool cacheHit = false;
    std::string cacheKey;
    int pendingActionCount = 0;
    std::string screenshotPolicy = "always";
    bool uiaEventsObserved = false;
    bool elementCacheValidated = false;
    int settleWaitedMs = 0;
    int settleEventCount = 0;
    bool settleTimedOut = false;
    unsigned long long settleBaselineRevision = 0;
    unsigned long long settleFinalRevision = 0;
};

static const int screenshotLongEdgeCapPx = 1024;
static const int adaptiveQuietMs = 140;
static const int adaptiveSettleTimeoutMs = 5000;
static bool processPerMonitorDpiAware = false;

static bool enablePerMonitorDpiAwareness() {
    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    if (user32) {
        typedef BOOL (WINAPI *SetProcessDpiAwarenessContextFn)(DPI_AWARENESS_CONTEXT);
        SetProcessDpiAwarenessContextFn setContext =
            reinterpret_cast<SetProcessDpiAwarenessContextFn>(
                GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
        if (setContext && setContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return true;
    }
    return !!SetProcessDPIAware();
}

static bool envFlag(const char* name) {
    char buffer[32] = {};
    DWORD len = GetEnvironmentVariableA(name, buffer, sizeof(buffer));
    if (len == 0 || len >= sizeof(buffer)) return false;
    std::string v(buffer);
    std::transform(v.begin(), v.end(), v.begin(), ::tolower);
    return v == "1" || v == "true" || v == "yes" || v == "on";
}

// This is the same 23x24 cursor artwork used by the browser agent cursor. Keep
// the bytes in the native helper so background Win32 input can have the same
// visual affordance without involving Stella's renderer.
static const char* kAgentCursorPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAC4AAAAwCAYAAABuZUjcAAAABmJLR0QA/wD/AP+gvaeTAAAEeklEQVRoge2YXWgcVRTHf2dndzOzm6+KiUUMhNooNG0qeQhNJaZpEiNFm6ItPhQSxYBiBeubCmJ9ENsH0QcRpakWLJogQdpSUCJpkgcJJimIGLGlsMU8pEpr0jQfm93k+DCTr5pkszuzTcH9wzCXYff+f+cy95xzBzLKKKN7UpLoB6pqAk3AY8AvwFciMpluMFdSVVNV+3S5/lTVZlX1bTTfqlLVl1VVY19e09HGAR07HtHYyMx8AIOqWrdRbIlWrRRg8tzfRKMGoxdvE2mJMHLqJrMTc+VAp6r2qmpN+lGXKxH4rwBU3M+0BohqgKkZP8Ptk/Q33SDSNk18SquALieA/XfrFVpzc6pqCPgjfj32UKQlwtSMn6gG7CCw75obZMuhICWNQiAEwGXgY+CMiIxvCLgD3wycHjl1k+H2yWXQ80FMi0EsF0r2QXkj5BcCMA60AydF5OeNAPcB/bMTc+X9TTeYuGX8B3rCDxMGTBowlQVbd8HuetheBmI7DAFtQJuIXLkr4A58HdAZaZvmt9bYqtB3jsMPwN5qqK2EosKF6S4B54ELwKCIzKUN3IHvjU9p1feHZ7g16k8IvXQcy4JHS6ChHBp2QFH+wrTXgR+AHqBHRK6mA7wG6Br6RulrlaSgY6Z9j5v2eMuDsHcr1BdDRQEEF/PQMNAHDDjXoIiMugJ34Htjk1R9cRj+iaYGHTMhnrU4DoagcjPUFED1fVAWhvBiILPAWeClOwNIFnw/cLbrJHSfcw8dzwKxwDKVkKVYlhK2lG05sDMMFaZQZxgIdIjIQTfgPuD30b945P1X7XznJbRlOeMlz44SYA/GHJArIhPzLElVOScDfJRfaKe8dEOvpVTK8xlgfHd9eqE3IbxCgGoMgO+WrnZK4CJyG2jbXmbnaa+hCy14AT+fkcVTGIi9OVu8WHGAVhG7uHgFHbaUZywfnxLkAH6yoAt4XEQOrJQSUwJ3eo+h2kpvoB8OwYdWgNcIkINcBupFpFZEflqNwU0L2lZUaFdEN9B12cInZoBSfFHgGFAmIj8mMncD/jXYZTwV6LCpHM01eDcYIBu5BuwRkfdEJLoe85TBnb7iUsOO5KFzTOVYnp/n/AbYm2+niPQl4+/2tHK+KN/uPZKBPpHnp8bwAZwGDorIWLLGbsEvgN0wrQc6ZCpv5xlU2NDHReRFEYmnYuwWfBAYqS9e30Z8Pdeg3jAAPheRt9wYuwJ3WoDOigK7y1sL+slsWfpOH3Hj6xrcUU/QB7s2rw5dHII3gn6Aq0CziMy6NfUCvBugtpBVK+Kbpp9sJAo8n8pGXEmuwZ20OPzEJlbsPZ62fJTaNh+IyKBrYkdefbzpKwtDeIWGqRk/wBXghEdegHfgA2EfbMtZ/p4/i0GOfVY5IiLTHnkB2MvhgQbAPm6N+Rb76X329F0i0umRz4K8WvFBIF5p+hZOLofs1hTgHY880iNV/XZOVbs1rt0a1zn7U3THRnMllKrmq2qHqsadq0NV8xP/8x6Rqlqqam00R0YZZZTR/0T/AonhuxCuMeKdAAAAAElFTkSuQmCC";

class AgentCursorOverlay {
public:
    AgentCursorOverlay() {
        worker_ = std::thread(&AgentCursorOverlay::run, this);
        std::unique_lock<std::mutex> lock(mutex_);
        started_.wait(lock, [this] { return startedReady_; });
    }

    ~AgentCursorOverlay() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            stopping_ = true;
        }
        wake_.notify_all();
        if (worker_.joinable()) worker_.join();
    }

    AgentCursorOverlay(const AgentCursorOverlay&) = delete;
    AgentCursorOverlay& operator=(const AgentCursorOverlay&) = delete;

    // Returns once the software cursor has arrived at the action point. The
    // caller intentionally dispatches the real input only after this returns.
    bool moveToAndWait(POINT target, HWND targetWindow) {
        std::unique_lock<std::mutex> lock(mutex_);
        if (!startupOk_ || stopping_) return false;
        target_ = target;
        targetWindow_ = targetWindow;
        hasTarget_ = true;
        visible_ = true;
        const unsigned long long request = ++requestGeneration_;
        lastActivity_ = std::chrono::steady_clock::now();
        wake_.notify_all();
        const bool completed = arrived_.wait_for(lock, std::chrono::seconds(5), [this, request] {
            return stopping_ || arrivedGeneration_ >= request;
        });
        return completed && !stopping_ && arrivedGeneration_ >= request;
    }

    void hide() {
        std::lock_guard<std::mutex> lock(mutex_);
        visible_ = false;
        hasTarget_ = false;
        wake_.notify_all();
    }

private:
    static constexpr int kCanvasSize = 64;
    static constexpr double kBaseRotation = -44.0;
    static constexpr double kThinkDurationSeconds = 1.41;
    static constexpr double kThinkPeriodSeconds = 0.66;
    static constexpr double kThinkAmplitudeDegrees = 12.5;
    static constexpr double kIdleTimeoutSeconds = 20.0;

    static LRESULT CALLBACK windowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
        switch (message) {
        case WM_NCHITTEST:
            return HTTRANSPARENT;
        case WM_MOUSEACTIVATE:
            return MA_NOACTIVATE;
        case WM_ERASEBKGND:
            return 1;
        case WM_DESTROY:
            return 0;
        default:
            return DefWindowProcW(hwnd, message, wParam, lParam);
        }
    }

    static std::vector<unsigned char> decodeBase64(const char* input) {
        static const char alphabet[] =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::vector<unsigned char> output;
        unsigned int value = 0;
        int bits = -8;
        for (const unsigned char* cursor = reinterpret_cast<const unsigned char*>(input);
             cursor && *cursor; ++cursor) {
            if (*cursor == '=') break;
            const char* found = strchr(alphabet, *cursor);
            if (!found) continue;
            value = (value << 6) | (unsigned int)(found - alphabet);
            bits += 6;
            if (bits >= 0) {
                output.push_back((unsigned char)((value >> bits) & 0xff));
                bits -= 8;
            }
        }
        return output;
    }

    bool loadCursorAsset() {
        std::vector<unsigned char> bytes = decodeBase64(kAgentCursorPngBase64);
        if (bytes.empty()) return false;
        HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes.size());
        if (!memory) return false;
        void* destination = GlobalLock(memory);
        if (!destination) {
            GlobalFree(memory);
            return false;
        }
        memcpy(destination, bytes.data(), bytes.size());
        GlobalUnlock(memory);
        IStream* stream = nullptr;
        if (FAILED(CreateStreamOnHGlobal(memory, TRUE, &stream)) || !stream) {
            GlobalFree(memory);
            return false;
        }
        std::unique_ptr<Gdiplus::Bitmap> bitmap;
        {
            Gdiplus::Bitmap decoded(stream);
            if (decoded.GetLastStatus() == Gdiplus::Ok) {
                bitmap.reset(decoded.Clone(
                    0,
                    0,
                    decoded.GetWidth(),
                    decoded.GetHeight(),
                    PixelFormat32bppARGB));
            }
        }
        stream->Release();
        if (!bitmap || bitmap->GetLastStatus() != Gdiplus::Ok) return false;
        cursorAsset_ = std::move(bitmap);
        return true;
    }

    bool createWindow() {
        if (!loadCursorAsset()) return false;
        HINSTANCE instance = GetModuleHandleW(nullptr);
        static const wchar_t className[] = L"StellaComputerAgentCursor";
        WNDCLASSEXW windowClass = {};
        windowClass.cbSize = sizeof(windowClass);
        windowClass.hInstance = instance;
        windowClass.lpfnWndProc = &AgentCursorOverlay::windowProc;
        windowClass.lpszClassName = className;
        windowClass.hCursor = LoadCursor(nullptr, IDC_ARROW);
        RegisterClassExW(&windowClass);
        hwnd_ = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            className,
            L"Stella computer-use cursor",
            WS_POPUP,
            0, 0, kCanvasSize, kCanvasSize,
            nullptr, nullptr, instance, nullptr);
        if (!hwnd_) return false;
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif
        SetWindowDisplayAffinity(hwnd_, WDA_EXCLUDEFROMCAPTURE);
        return true;
    }

    void render(double x, double y, double rotation, HWND targetWindow) {
        if (!hwnd_ || !cursorAsset_) return;
        Gdiplus::Bitmap canvas(kCanvasSize, kCanvasSize, PixelFormat32bppARGB);
        Gdiplus::Graphics graphics(&canvas);
        graphics.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
        graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
        graphics.Clear(Gdiplus::Color(0, 0, 0, 0));

        // A soft blue radial glow, deliberately limited to the cursor. There
        // is no click ring, pulse, or tail in the Windows contract.
        Gdiplus::GraphicsPath glowPath;
        glowPath.AddEllipse(Gdiplus::RectF(8.0f, 8.0f, 48.0f, 48.0f));
        Gdiplus::PathGradientBrush glowBrush(&glowPath);
        glowBrush.SetCenterColor(Gdiplus::Color(100, 51, 156, 255));
        Gdiplus::Color edge(0, 51, 156, 255);
        INT edgeCount = 1;
        glowBrush.SetSurroundColors(&edge, &edgeCount);
        graphics.FillPath(&glowBrush, &glowPath);

        graphics.TranslateTransform((Gdiplus::REAL)(kCanvasSize / 2), (Gdiplus::REAL)(kCanvasSize / 2));
        graphics.RotateTransform((Gdiplus::REAL)rotation);
        graphics.TranslateTransform(-12.0f, -12.0f);
        graphics.TranslateTransform(12.0f, -2.5f);
        graphics.RotateTransform(44.0f);
        graphics.DrawImage(cursorAsset_.get(), Gdiplus::RectF(0, 0, 23, 24));

        HBITMAP bitmap = nullptr;
        if (canvas.GetHBITMAP(Gdiplus::Color(0, 0, 0, 0), &bitmap) != Gdiplus::Ok || !bitmap) return;
        HDC screen = GetDC(nullptr);
        HDC memory = CreateCompatibleDC(screen);
        HGDIOBJ previous = SelectObject(memory, bitmap);
        POINT destination = {
            (LONG)std::lround(x - kCanvasSize / 2.0),
            (LONG)std::lround(y - kCanvasSize / 2.0),
        };
        SIZE size = { kCanvasSize, kCanvasSize };
        POINT source = { 0, 0 };
        BLENDFUNCTION blend = { AC_SRC_OVER, 0, 255, AC_SRC_ALPHA };
        if (targetWindow && IsWindow(targetWindow) && targetWindow != attachedTargetWindow_) {
            SetWindowLongPtrW(hwnd_, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(targetWindow));
            attachedTargetWindow_ = targetWindow;
        }
        SetWindowPos(hwnd_, HWND_TOP, destination.x, destination.y,
                     kCanvasSize, kCanvasSize,
                     SWP_NOACTIVATE | SWP_SHOWWINDOW);
        UpdateLayeredWindow(hwnd_, screen, &destination, &size, memory, &source,
                            0, &blend, ULW_ALPHA);
        SelectObject(memory, previous);
        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(nullptr, screen);
    }

    void hideWindow() {
        if (hwnd_) ShowWindow(hwnd_, SW_HIDE);
    }

    static void pumpMessages() {
        MSG message = {};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    void run() {
        const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        const bool ownsComApartment = SUCCEEDED(comResult);
        startupOk_ = (ownsComApartment || comResult == RPC_E_CHANGED_MODE) && createWindow();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (startupOk_) {
                POINT cursor = {};
                if (GetCursorPos(&cursor)) {
                    currentX_ = (double)cursor.x;
                    currentY_ = (double)cursor.y;
                }
            }
            startedReady_ = true;
        }
        started_.notify_all();
        if (!startupOk_) {
            if (ownsComApartment) CoUninitialize();
            return;
        }

        std::unique_lock<std::mutex> lock(mutex_);
        while (!stopping_) {
            pumpMessages();
            const auto now = std::chrono::steady_clock::now();
            if (hasTarget_) {
                const POINT target = target_;
                const HWND targetWindow = targetWindow_;
                const double startX = currentX_;
                const double startY = currentY_;
                const unsigned long long request = requestGeneration_;
                hasTarget_ = false;
                const double distance = std::hypot((double)target.x - startX, (double)target.y - startY);
                const double duration = std::max(0.25, std::min(0.85, distance / 900.0));
                const bool useScoot = distance <= 196.0;
                const double directX = distance > 0.001 ? ((double)target.x - startX) / distance : 0.0;
                const double directY = distance > 0.001 ? ((double)target.y - startY) / distance : 0.0;
                const double scootRotation = std::max(-1.0, std::min(1.0, directX * 0.75 - directY * 0.62)) * 70.0;
                const double clickX = std::sin(-44.0 * 3.141592653589793 / 180.0);
                const double clickY = -std::cos(-44.0 * 3.141592653589793 / 180.0);
                const double startHandle = std::max(48.0, std::min({640.0, distance * 0.41960295031576633, distance * 0.9}));
                const double endHandle = std::max(48.0, std::min({640.0, distance * 0.15, distance * 0.9}));
                const double virtualLeft = (double)GetSystemMetrics(SM_XVIRTUALSCREEN) + 20.0;
                const double virtualTop = (double)GetSystemMetrics(SM_YVIRTUALSCREEN) + 20.0;
                const double virtualRight = virtualLeft + (double)GetSystemMetrics(SM_CXVIRTUALSCREEN) - 40.0;
                const double virtualBottom = virtualTop + (double)GetSystemMetrics(SM_CYVIRTUALSCREEN) - 40.0;
                const auto clampX = [virtualLeft, virtualRight](double value) {
                    return std::max(virtualLeft, std::min(virtualRight, value));
                };
                const auto clampY = [virtualTop, virtualBottom](double value) {
                    return std::max(virtualTop, std::min(virtualBottom, value));
                };
                const double control1X = clampX(startX + clickX * startHandle);
                const double control1Y = clampY(startY + clickY * startHandle);
                const double control2X = clampX((double)target.x - clickX * endHandle);
                const double control2Y = clampY((double)target.y - clickY * endHandle);
                lock.unlock();
                const auto startedAt = std::chrono::steady_clock::now();
                while (true) {
                    pumpMessages();
                    const double elapsed = std::chrono::duration<double>(
                        std::chrono::steady_clock::now() - startedAt).count();
                    const double progress = std::min(1.0, elapsed / duration);
                    const double eased = progress * progress * (3.0 - 2.0 * progress);
                    double nextX = startX + ((double)target.x - startX) * eased;
                    double nextY = startY + ((double)target.y - startY) * eased;
                    double rotation = kBaseRotation;
                    if (useScoot) {
                        rotation += std::sin(eased * 3.141592653589793) * scootRotation;
                    } else {
                        const double inverse = 1.0 - eased;
                        nextX = inverse * inverse * inverse * startX
                            + 3.0 * inverse * inverse * eased * control1X
                            + 3.0 * inverse * eased * eased * control2X
                            + eased * eased * eased * (double)target.x;
                        nextY = inverse * inverse * inverse * startY
                            + 3.0 * inverse * inverse * eased * control1Y
                            + 3.0 * inverse * eased * eased * control2Y
                            + eased * eased * eased * (double)target.y;
                        const double tangentX = 3.0 * inverse * inverse * (control1X - startX)
                            + 6.0 * inverse * eased * (control2X - control1X)
                            + 3.0 * eased * eased * ((double)target.x - control2X);
                        const double tangentY = 3.0 * inverse * inverse * (control1Y - startY)
                            + 6.0 * inverse * eased * (control2Y - control1Y)
                            + 3.0 * eased * eased * ((double)target.y - control2Y);
                        if (std::hypot(tangentX, tangentY) > 0.001) {
                            rotation = std::atan2(tangentY, tangentX) * 180.0 / 3.141592653589793 + 90.0;
                        }
                    }
                    render(nextX, nextY, rotation, targetWindow);
                    if (progress >= 1.0) break;
                    std::this_thread::sleep_for(std::chrono::milliseconds(16));
                }
                lock.lock();
                currentX_ = (double)target.x;
                currentY_ = (double)target.y;
                arrivedGeneration_ = std::max(arrivedGeneration_, request);
                wobbleStartedAt_ = std::chrono::steady_clock::now();
                wobbling_ = true;
                lastActivity_ = wobbleStartedAt_;
                arrived_.notify_all();
                continue;
            }

            if (visible_) {
                const double idleSeconds = std::chrono::duration<double>(now - lastActivity_).count();
                if (idleSeconds > kIdleTimeoutSeconds) {
                    visible_ = false;
                    wobbling_ = false;
                    hideWindow();
                } else {
                    double rotation = kBaseRotation;
                    if (wobbling_) {
                        const double elapsed = std::chrono::duration<double>(now - wobbleStartedAt_).count();
                        if (elapsed >= kThinkDurationSeconds) {
                            wobbling_ = false;
                        } else {
                            const double envelope = std::sin((elapsed / kThinkDurationSeconds) * 3.141592653589793);
                            rotation += std::sin((elapsed / kThinkPeriodSeconds) * 2.0 * 3.141592653589793)
                                * envelope * kThinkAmplitudeDegrees;
                        }
                    }
                    lock.unlock();
                    render(currentX_, currentY_, rotation, targetWindow_);
                    lock.lock();
                }
            }
            if (!visible_) hideWindow();
            wake_.wait_for(lock, std::chrono::milliseconds(16), [this] {
                return stopping_ || hasTarget_;
            });
        }
        lock.unlock();
        hideWindow();
        if (hwnd_) {
            DestroyWindow(hwnd_);
            hwnd_ = nullptr;
        }
        if (ownsComApartment) CoUninitialize();
    }

    std::thread worker_;
    std::mutex mutex_;
    std::condition_variable wake_;
    std::condition_variable started_;
    std::condition_variable arrived_;
    bool startedReady_ = false;
    bool startupOk_ = false;
    bool stopping_ = false;
    bool visible_ = false;
    bool hasTarget_ = false;
    bool wobbling_ = false;
    HWND hwnd_ = nullptr;
    HWND targetWindow_ = nullptr;
    HWND attachedTargetWindow_ = nullptr;
    std::unique_ptr<Gdiplus::Bitmap> cursorAsset_;
    POINT target_ = {};
    unsigned long long requestGeneration_ = 0;
    unsigned long long arrivedGeneration_ = 0;
    double currentX_ = 0;
    double currentY_ = 0;
    std::chrono::steady_clock::time_point lastActivity_ = std::chrono::steady_clock::now();
    std::chrono::steady_clock::time_point wobbleStartedAt_ = std::chrono::steady_clock::now();
};

static AgentCursorOverlay* gAgentCursorOverlay = nullptr;

static std::string readUtf8File(const std::wstring& path) {
    HANDLE file = CreateFileW(
        path.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (file == INVALID_HANDLE_VALUE) return "";
    std::string contents;
    char chunk[8192];
    DWORD read = 0;
    while (ReadFile(file, chunk, (DWORD)sizeof(chunk), &read, nullptr) && read > 0) {
        contents.append(chunk, read);
    }
    CloseHandle(file);
    return contents;
}

static std::string appInstructionsFor(const std::wstring& processName) {
    wchar_t directory[32768] = {};
    DWORD length = GetEnvironmentVariableW(
        L"STELLA_COMPUTER_APP_INSTRUCTIONS_DIR",
        directory,
        (DWORD)(sizeof(directory) / sizeof(directory[0])));
    if (length == 0 || length >= sizeof(directory) / sizeof(directory[0])) return "";

    std::wstring safeName = processName;
    size_t slash = safeName.find_last_of(L"\\/");
    if (slash != std::wstring::npos) safeName = safeName.substr(slash + 1);
    std::vector<std::wstring> candidates = {safeName + L".md"};
    size_t dot = safeName.find_last_of(L'.');
    if (dot != std::wstring::npos) candidates.push_back(safeName.substr(0, dot) + L".md");
    for (const std::wstring& candidate : candidates) {
        std::wstring path = directory;
        if (!path.empty() && path.back() != L'\\' && path.back() != L'/') path += L'\\';
        std::string contents = readUtf8File(path + candidate);
        if (!contents.empty()) return contents;
    }
    return "";
}

static std::wstring lowerW(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), towlower);
    return value;
}

static std::wstring getWindowText(HWND hwnd) {
    int len = GetWindowTextLengthW(hwnd);
    if (len <= 0) return L"";
    std::wstring text(len + 1, L'\0');
    GetWindowTextW(hwnd, &text[0], len + 1);
    text.resize(wcslen(text.c_str()));
    return text;
}

static std::wstring baseNameFromPath(const std::wstring& path) {
    size_t slash = path.find_last_of(L"\\/");
    std::wstring name = slash == std::wstring::npos ? path : path.substr(slash + 1);
    if (name.size() > 4 && lowerW(name.substr(name.size() - 4)) == L".exe") {
        name.resize(name.size() - 4);
    }
    return name;
}

static std::wstring processNameForPid(DWORD pid) {
    std::wstring fallback;
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32W entry = {};
        entry.dwSize = sizeof(entry);
        if (Process32FirstW(snapshot, &entry)) {
            do {
                if (entry.th32ProcessID == pid) {
                    fallback = baseNameFromPath(entry.szExeFile);
                    break;
                }
            } while (Process32NextW(snapshot, &entry));
        }
        CloseHandle(snapshot);
    }

    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (process) {
        wchar_t path[MAX_PATH * 4] = {};
        DWORD size = (DWORD)(sizeof(path) / sizeof(path[0]));
        if (QueryFullProcessImageNameW(process, 0, path, &size)) {
            fallback = baseNameFromPath(path);
        }
        CloseHandle(process);
    }
    return fallback.empty() ? L"unknown" : fallback;
}

static long long hwndValue(HWND hwnd) {
    return (long long)(uintptr_t)hwnd;
}

static HWND hwndFromValue(long long value) {
    return (HWND)(uintptr_t)value;
}

static long long parseHwndTarget(const std::wstring& query) {
    std::wstring lower = lowerW(query);
    const std::wstring prefix = L"hwnd:";
    if (lower.rfind(prefix, 0) != 0) return 0;
    wchar_t* end = nullptr;
    unsigned long long value = wcstoull(lower.c_str() + prefix.size(), &end, 10);
    return value > 0 ? (long long)value : 0;
}

static std::wstring classNameForWindow(HWND hwnd);

static DWORD integrityRidForProcess(DWORD pid) {
    HANDLE process = pid == GetCurrentProcessId()
        ? GetCurrentProcess()
        : OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return 0;

    HANDLE token = NULL;
    DWORD rid = 0;
    if (OpenProcessToken(process, TOKEN_QUERY, &token)) {
        DWORD bytes = 0;
        GetTokenInformation(token, TokenIntegrityLevel, NULL, 0, &bytes);
        if (bytes > 0) {
            std::vector<BYTE> buffer(bytes);
            if (GetTokenInformation(token, TokenIntegrityLevel, buffer.data(), bytes, &bytes)) {
                TOKEN_MANDATORY_LABEL* label = reinterpret_cast<TOKEN_MANDATORY_LABEL*>(buffer.data());
                DWORD count = *GetSidSubAuthorityCount(label->Label.Sid);
                rid = *GetSidSubAuthority(label->Label.Sid, count - 1);
            }
        }
        CloseHandle(token);
    }
    if (pid != GetCurrentProcessId()) CloseHandle(process);
    return rid;
}

static std::string integrityName(DWORD rid) {
    if (rid == 0) return "unknown";
    if (rid < SECURITY_MANDATORY_MEDIUM_RID) return "low";
    if (rid < SECURITY_MANDATORY_HIGH_RID) return "medium";
    if (rid < SECURITY_MANDATORY_SYSTEM_RID) return "high";
    return "system";
}

// UIPI: Windows drops input (posted messages and SendInput alike) aimed at a
// window whose process runs at a higher integrity level, and SendInput does
// not even report it. Refuse up front with the reason instead.
static void ensureInputAllowedByIntegrity(DWORD targetPid) {
    DWORD currentRid = integrityRidForProcess(GetCurrentProcessId());
    DWORD targetRid = integrityRidForProcess(targetPid);
    if (currentRid != 0 && targetRid != 0 && targetRid > currentRid) {
        throw CodedError(
            "uipi_blocked",
            "Windows blocks Stella's input to this app: it runs at " + integrityName(targetRid) +
            " integrity (as administrator) while Stella runs at " + integrityName(currentRid) +
            ". Windows (UIPI) drops that input without reporting an error, so nothing was sent. "
            "Restart the app without 'Run as administrator', or ask the user to do this step.");
    }
}

static void ensureCanPostMessages(DWORD targetPid) {
    ensureInputAllowedByIntegrity(targetPid);
}

static void appendWindowProcess(std::vector<WindowProcess>& windows, const WindowProcess& item) {
    if (!item.hwnd || !IsWindow(item.hwnd) || item.pid == 0) return;
    for (WindowProcess& existing : windows) {
        if (existing.hwnd == item.hwnd) {
            if (existing.title.empty()) existing.title = item.title;
            if (existing.processName == L"unknown" && item.processName != L"unknown") existing.processName = item.processName;
            return;
        }
    }
    windows.push_back(item);
}

static BOOL CALLBACK enumWindowsProc(HWND hwnd, LPARAM lParam) {
    if (!IsWindowVisible(hwnd)) return TRUE;
    RECT rect = {};
    if (!GetWindowRect(hwnd, &rect) || rect.right <= rect.left || rect.bottom <= rect.top) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) return TRUE;
    auto* out = reinterpret_cast<std::vector<WindowProcess>*>(lParam);
    WindowProcess item;
    item.hwnd = hwnd;
    item.pid = pid;
    item.title = getWindowText(hwnd);
    item.processName = processNameForPid(pid);
    appendWindowProcess(*out, item);
    return TRUE;
}

static void appendUiaWindowElement(IUIAutomationElement* element, std::vector<WindowProcess>& windows) {
    if (!element) return;
    UIA_HWND native = NULL;
    if (FAILED(element->get_CurrentNativeWindowHandle(&native)) || native == 0) return;
    HWND hwnd = (HWND)(intptr_t)native;
    if (!IsWindow(hwnd) || !IsWindowVisible(hwnd)) return;
    RECT rect = {};
    if (!GetWindowRect(hwnd, &rect) || rect.right <= rect.left || rect.bottom <= rect.top) return;
    int elementPid = 0;
    DWORD pid = 0;
    if (SUCCEEDED(element->get_CurrentProcessId(&elementPid)) && elementPid > 0) pid = (DWORD)elementPid;
    if (pid == 0) GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) return;
    WindowProcess item;
    item.hwnd = hwnd;
    item.pid = pid;
    BSTR name = nullptr;
    if (SUCCEEDED(element->get_CurrentName(&name))) item.title = bstrToWstring(name);
    if (name) SysFreeString(name);
    if (item.title.empty()) item.title = getWindowText(hwnd);
    item.processName = processNameForPid(pid);
    appendWindowProcess(windows, item);
}

static void appendUiaWindows(IUIAutomation* uia, std::vector<WindowProcess>& windows) {
    if (!uia) return;
    IUIAutomationElement* root = nullptr;
    if (FAILED(uia->GetRootElement(&root)) || !root) return;
    VARIANT controlType;
    VariantInit(&controlType);
    controlType.vt = VT_I4;
    controlType.lVal = UIA_WindowControlTypeId;
    IUIAutomationCondition* condition = nullptr;
    IUIAutomationElementArray* elements = nullptr;
    if (SUCCEEDED(uia->CreatePropertyCondition(UIA_ControlTypePropertyId, controlType, &condition)) &&
        SUCCEEDED(root->FindAll(TreeScope_Children, condition, &elements)) && elements) {
        int length = 0;
        elements->get_Length(&length);
        for (int i = 0; i < length; i++) {
            IUIAutomationElement* element = nullptr;
            if (SUCCEEDED(elements->GetElement(i, &element)) && element) {
                appendUiaWindowElement(element, windows);
            }
            safeRelease(element);
        }
    }
    safeRelease(elements);
    safeRelease(condition);
    safeRelease(root);
}

static std::vector<WindowProcess> listWindowProcesses(IUIAutomation* uia = nullptr) {
    std::vector<WindowProcess> windows;
    EnumWindows(enumWindowsProc, reinterpret_cast<LPARAM>(&windows));
    appendUiaWindows(uia, windows);
    return windows;
}

static WindowProcess windowProcessFromHwnd(HWND hwnd) {
    if (!hwnd || !IsWindow(hwnd)) {
        throw std::runtime_error("windowNotFound");
    }
    RECT rect = {};
    if (!GetWindowRect(hwnd, &rect) || rect.right <= rect.left || rect.bottom <= rect.top) {
        throw std::runtime_error("windowNotFound");
    }
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) throw std::runtime_error("windowNotFound");
    WindowProcess item;
    item.hwnd = hwnd;
    item.pid = pid;
    item.title = getWindowText(hwnd);
    item.processName = processNameForPid(pid);
    return item;
}

static WindowProcess resolveApp(IUIAutomation* uia, const std::wstring& query, long long windowId = 0) {
    if (windowId > 0) return windowProcessFromHwnd(hwndFromValue(windowId));
    long long targetHwnd = parseHwndTarget(query);
    if (targetHwnd > 0) return windowProcessFromHwnd(hwndFromValue(targetHwnd));

    std::wstring normalized = query;
    std::wstring processQuery = normalized;
    if (processQuery.size() > 4 && lowerW(processQuery.substr(processQuery.size() - 4)) == L".exe") {
        processQuery.resize(processQuery.size() - 4);
    }
    std::wstring lowerQuery = lowerW(normalized);
    std::wstring lowerProcessQuery = lowerW(processQuery);
    DWORD pidQuery = (DWORD)_wtoi(normalized.c_str());

    std::vector<WindowProcess> windows = listWindowProcesses(uia);
    for (const auto& win : windows) {
        if (pidQuery > 0 && win.pid == pidQuery) return win;
    }
    for (const auto& win : windows) {
        std::wstring name = lowerW(win.processName);
        std::wstring title = lowerW(win.title);
        if (name == lowerProcessQuery || name + L".exe" == lowerQuery || title == lowerQuery ||
            (!lowerQuery.empty() && title.find(lowerQuery) != std::wstring::npos)) {
            return win;
        }
    }

    if (envFlag("STELLA_COMPUTER_WINDOWS_ALLOW_APP_LAUNCH")) {
        HWND previousForeground = GetForegroundWindow();
        SHELLEXECUTEINFOW info = {};
        info.cbSize = sizeof(info);
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpFile = normalized.c_str();
        info.nShow = SW_SHOWNOACTIVATE;
        if (ShellExecuteExW(&info) && info.hProcess) {
            DWORD launchedPid = GetProcessId(info.hProcess);
            for (int i = 0; i < 20; i++) {
                Sleep(250);
                for (const auto& win : listWindowProcesses(uia)) {
                    if (win.pid == launchedPid) {
                        HWND currentForeground = GetForegroundWindow();
                        if (previousForeground && currentForeground && previousForeground != currentForeground && IsWindow(previousForeground)) {
                            SetForegroundWindow(previousForeground);
                        }
                        CloseHandle(info.hProcess);
                        return win;
                    }
                }
            }
            CloseHandle(info.hProcess);
        }
        HWND currentForeground = GetForegroundWindow();
        if (previousForeground && currentForeground && previousForeground != currentForeground && IsWindow(previousForeground)) {
            SetForegroundWindow(previousForeground);
        }
    }

    throw std::runtime_error("appNotFound(\"" + toUtf8(query) + "\")");
}

static WindowProcess launchApp(IUIAutomation* uia, const std::wstring& query, bool startMinimized) {
    HWND previousForeground = GetForegroundWindow();
    std::set<long long> existingWindows;
    for (const auto& win : listWindowProcesses(uia)) {
        existingWindows.insert(hwndValue(win.hwnd));
    }
    SHELLEXECUTEINFOW info = {};
    info.cbSize = sizeof(info);
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpFile = query.c_str();
    info.nShow = startMinimized ? SW_SHOWMINNOACTIVE : SW_SHOWNOACTIVATE;
    DWORD launchedPid = 0;
    bool launchedOk = !!ShellExecuteExW(&info);
    if (launchedOk && info.hProcess) {
        launchedPid = GetProcessId(info.hProcess);
    }
    if (!launchedOk) {
        IApplicationActivationManager* activation = nullptr;
        HRESULT hr = CoCreateInstance(
            CLSID_ApplicationActivationManager,
            NULL,
            CLSCTX_INPROC_SERVER,
            IID_PPV_ARGS(&activation)
        );
        if (SUCCEEDED(hr) && activation) {
            hr = activation->ActivateApplication(query.c_str(), nullptr, AO_NONE, &launchedPid);
            activation->Release();
            launchedOk = SUCCEEDED(hr);
        }
    }
    if (!launchedOk) {
        throw std::runtime_error("launchFailed(\"" + toUtf8(query) + "\")");
    }

    WindowProcess launched;
    for (int i = 0; i < 40 && !launched.hwnd; i++) {
        Sleep(250);
        std::vector<WindowProcess> windows = listWindowProcesses(uia);
        for (const auto& win : windows) {
            if (launchedPid > 0 && win.pid == launchedPid) {
                launched = win;
                break;
            }
        }
        if (!launched.hwnd) {
            std::wstring lowerQuery = lowerW(query);
            for (const auto& win : windows) {
                std::wstring name = lowerW(win.processName);
                std::wstring title = lowerW(win.title);
                if (name == lowerQuery || name + L".exe" == lowerQuery ||
                    (!lowerQuery.empty() && title.find(lowerQuery) != std::wstring::npos)) {
                    launched = win;
                    break;
                }
            }
        }
        if (!launched.hwnd) {
            for (const auto& win : windows) {
                if (!existingWindows.count(hwndValue(win.hwnd))) {
                    launched = win;
                    break;
                }
            }
        }
    }
    if (info.hProcess) CloseHandle(info.hProcess);
    if (previousForeground && IsWindow(previousForeground) && GetForegroundWindow() != previousForeground) {
        SetForegroundWindow(previousForeground);
    }
    if (!launched.hwnd) {
        throw std::runtime_error("launchWindowNotFound(\"" + toUtf8(query) + "\")");
    }
    if (startMinimized) {
        ShowWindow(launched.hwnd, SW_SHOWMINNOACTIVE);
        ShowWindow(launched.hwnd, SW_MINIMIZE);
    }
    return launched;
}

static Frame frameFromRect(const RECT& rect) {
    Frame frame;
    frame.present = true;
    frame.x = rect.left;
    frame.y = rect.top;
    frame.width = rect.right - rect.left;
    frame.height = rect.bottom - rect.top;
    if (frame.width < 0 || frame.height < 0) frame.present = false;
    return frame;
}

static Frame windowBounds(HWND hwnd, IUIAutomationElement* element) {
    RECT rect = {};
    if (hwnd && SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect))) &&
        rect.right > rect.left && rect.bottom > rect.top) {
        return frameFromRect(rect);
    }
    if (hwnd && GetWindowRect(hwnd, &rect)) {
        return frameFromRect(rect);
    }
    if (element) {
        HRESULT hr = element->get_CurrentBoundingRectangle(&rect);
        if (SUCCEEDED(hr)) return frameFromRect(rect);
    }
    return {};
}

static std::vector<int> runtimeIdVector(SAFEARRAY* runtime) {
    std::vector<int> values;
    if (!runtime) return values;
    LONG lower = 0, upper = -1;
    SafeArrayGetLBound(runtime, 1, &lower);
    SafeArrayGetUBound(runtime, 1, &upper);
    for (LONG i = lower; i <= upper; i++) {
        int value = 0;
        if (SUCCEEDED(SafeArrayGetElement(runtime, &i, &value))) values.push_back(value);
    }
    return values;
}

static std::vector<int> getRuntimeId(IUIAutomationElement* element) {
    SAFEARRAY* runtime = nullptr;
    std::vector<int> values;
    if (element && SUCCEEDED(element->GetRuntimeId(&runtime))) {
        values = runtimeIdVector(runtime);
    }
    if (runtime) SafeArrayDestroy(runtime);
    return values;
}

static std::wstring getBstrProperty(HRESULT (IUIAutomationElement::*getter)(BSTR*), IUIAutomationElement* element) {
    BSTR bstr = nullptr;
    std::wstring out;
    if (element && SUCCEEDED((element->*getter)(&bstr))) {
        out = bstrToWstring(bstr);
    }
    if (bstr) SysFreeString(bstr);
    return out;
}

static std::wstring controlTypeName(CONTROLTYPEID id) {
    switch (id) {
    case UIA_ButtonControlTypeId: return L"ControlType.Button";
    case UIA_CalendarControlTypeId: return L"ControlType.Calendar";
    case UIA_CheckBoxControlTypeId: return L"ControlType.CheckBox";
    case UIA_ComboBoxControlTypeId: return L"ControlType.ComboBox";
    case UIA_EditControlTypeId: return L"ControlType.Edit";
    case UIA_HyperlinkControlTypeId: return L"ControlType.Hyperlink";
    case UIA_ImageControlTypeId: return L"ControlType.Image";
    case UIA_ListItemControlTypeId: return L"ControlType.ListItem";
    case UIA_ListControlTypeId: return L"ControlType.List";
    case UIA_MenuControlTypeId: return L"ControlType.Menu";
    case UIA_MenuBarControlTypeId: return L"ControlType.MenuBar";
    case UIA_MenuItemControlTypeId: return L"ControlType.MenuItem";
    case UIA_ProgressBarControlTypeId: return L"ControlType.ProgressBar";
    case UIA_RadioButtonControlTypeId: return L"ControlType.RadioButton";
    case UIA_ScrollBarControlTypeId: return L"ControlType.ScrollBar";
    case UIA_SliderControlTypeId: return L"ControlType.Slider";
    case UIA_SpinnerControlTypeId: return L"ControlType.Spinner";
    case UIA_StatusBarControlTypeId: return L"ControlType.StatusBar";
    case UIA_TabControlTypeId: return L"ControlType.Tab";
    case UIA_TabItemControlTypeId: return L"ControlType.TabItem";
    case UIA_TextControlTypeId: return L"ControlType.Text";
    case UIA_ToolBarControlTypeId: return L"ControlType.ToolBar";
    case UIA_ToolTipControlTypeId: return L"ControlType.ToolTip";
    case UIA_TreeControlTypeId: return L"ControlType.Tree";
    case UIA_TreeItemControlTypeId: return L"ControlType.TreeItem";
    case UIA_CustomControlTypeId: return L"ControlType.Custom";
    case UIA_GroupControlTypeId: return L"ControlType.Group";
    case UIA_ThumbControlTypeId: return L"ControlType.Thumb";
    case UIA_DataGridControlTypeId: return L"ControlType.DataGrid";
    case UIA_DataItemControlTypeId: return L"ControlType.DataItem";
    case UIA_DocumentControlTypeId: return L"ControlType.Document";
    case UIA_SplitButtonControlTypeId: return L"ControlType.SplitButton";
    case UIA_WindowControlTypeId: return L"ControlType.Window";
    case UIA_PaneControlTypeId: return L"ControlType.Pane";
    case UIA_HeaderControlTypeId: return L"ControlType.Header";
    case UIA_HeaderItemControlTypeId: return L"ControlType.HeaderItem";
    case UIA_TableControlTypeId: return L"ControlType.Table";
    case UIA_TitleBarControlTypeId: return L"ControlType.TitleBar";
    case UIA_SeparatorControlTypeId: return L"ControlType.Separator";
    default: return L"ControlType." + std::to_wstring(id);
    }
}

template <typename T>
static T* getPattern(IUIAutomationElement* element, PATTERNID patternId) {
    if (!element) return nullptr;
    T* pattern = nullptr;
    HRESULT hr = element->GetCurrentPatternAs(patternId, __uuidof(T), reinterpret_cast<void**>(&pattern));
    return SUCCEEDED(hr) ? pattern : nullptr;
}

static std::wstring getElementValue(IUIAutomationElement* element) {
    IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
    std::wstring out;
    if (value) {
        BSTR bstr = nullptr;
        if (SUCCEEDED(value->get_CurrentValue(&bstr))) out = bstrToWstring(bstr);
        if (bstr) SysFreeString(bstr);
        value->Release();
    }
    if (out.size() > 500) out.resize(500);
    return out;
}

static std::vector<std::string> getPatternNames(IUIAutomationElement* element) {
    std::vector<std::string> names;
    if (!element) return names;
    IUIAutomationInvokePattern* invoke = getPattern<IUIAutomationInvokePattern>(element, UIA_InvokePatternId);
    if (invoke) {
        names.push_back("Invoke");
        invoke->Release();
    }
    IUIAutomationTogglePattern* toggle = getPattern<IUIAutomationTogglePattern>(element, UIA_TogglePatternId);
    if (toggle) {
        names.push_back("Toggle");
        toggle->Release();
    }
    IUIAutomationSelectionItemPattern* selection = getPattern<IUIAutomationSelectionItemPattern>(element, UIA_SelectionItemPatternId);
    if (selection) {
        names.push_back("Select");
        selection->Release();
    }
    IUIAutomationExpandCollapsePattern* expand = getPattern<IUIAutomationExpandCollapsePattern>(element, UIA_ExpandCollapsePatternId);
    if (expand) {
        ExpandCollapseState state = ExpandCollapseState_LeafNode;
        if (SUCCEEDED(expand->get_CurrentExpandCollapseState(&state))) {
            if (state == ExpandCollapseState_Expanded) names.push_back("Collapse");
            else if (state == ExpandCollapseState_Collapsed) names.push_back("Expand");
            else {
                names.push_back("Expand");
                names.push_back("Collapse");
            }
        } else {
            names.push_back("Expand");
            names.push_back("Collapse");
        }
        expand->Release();
    }
    IUIAutomationScrollItemPattern* scrollItem = getPattern<IUIAutomationScrollItemPattern>(element, UIA_ScrollItemPatternId);
    if (scrollItem) {
        names.push_back("ScrollIntoView");
        scrollItem->Release();
    }
    IUIAutomationScrollPattern* scroll = getPattern<IUIAutomationScrollPattern>(element, UIA_ScrollPatternId);
    if (scroll) {
        names.push_back("Scroll");
        scroll->Release();
    }
    IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
    if (value) {
        names.push_back("SetValue");
        value->Release();
    }
    std::sort(names.begin(), names.end());
    names.erase(std::unique(names.begin(), names.end()), names.end());
    return names;
}

static ElementRecord elementRecord(IUIAutomationElement* element, int index, const Frame& windowFrame) {
    ElementRecord record;
    record.index = index;
    record.runtimeId = getRuntimeId(element);
    record.automationId = getBstrProperty(&IUIAutomationElement::get_CurrentAutomationId, element);
    record.name = getBstrProperty(&IUIAutomationElement::get_CurrentName, element);
    record.localizedControlType = getBstrProperty(&IUIAutomationElement::get_CurrentLocalizedControlType, element);
    record.className = getBstrProperty(&IUIAutomationElement::get_CurrentClassName, element);
    record.value = getElementValue(element);
    CONTROLTYPEID ctid = 0;
    if (SUCCEEDED(element->get_CurrentControlType(&ctid))) record.controlType = controlTypeName(ctid);
    UIA_HWND handle = NULL;
    if (SUCCEEDED(element->get_CurrentNativeWindowHandle(&handle))) {
        record.nativeWindowHandle = (long long)(intptr_t)handle;
    }
    RECT rect = {};
    if (SUCCEEDED(element->get_CurrentBoundingRectangle(&rect))) {
        Frame absolute = frameFromRect(rect);
        if (absolute.present) {
            record.frame = absolute;
            if (windowFrame.present) {
                record.frame.x -= windowFrame.x;
                record.frame.y -= windowFrame.y;
            }
        }
    }
    record.actions = getPatternNames(element);
    return record;
}

static std::wstring elementTitle(const ElementRecord& record) {
    if (!record.name.empty()) return record.name;
    if (!record.automationId.empty()) return L"ID: " + record.automationId;
    return L"";
}

static std::string frameJson(const Frame& frame) {
    if (!frame.present) return "null";
    std::ostringstream out;
    out << "{\"x\":" << frame.x << ",\"y\":" << frame.y << ",\"width\":" << frame.width
        << ",\"height\":" << frame.height << "}";
    return out.str();
}

static const size_t MAX_TREE_ELEMENTS = 3000;
static const int MAX_TREE_DEPTH = 24;

static std::string runtimeIdKey(const std::vector<int>& runtimeId) {
    std::ostringstream key;
    for (int value : runtimeId) key << value << ".";
    return key.str();
}

static void appendTreeLine(const ElementRecord& record, int depth, std::vector<std::string>& lines) {
    std::wstring role = !record.localizedControlType.empty() ? record.localizedControlType : record.controlType;
    std::wstring title = elementTitle(record);
    std::string line((depth + 1), '\t');
    line += std::to_string(record.index) + " " + toUtf8(role) + " " + toUtf8(title);
    if (!record.value.empty() && record.value != title) {
        std::string value = toUtf8(record.value);
        std::replace(value.begin(), value.end(), '\r', ' ');
        std::replace(value.begin(), value.end(), '\n', ' ');
        line += " Value: " + value;
    }
    if (!record.actions.empty()) {
        line += " Secondary Actions: ";
        for (size_t i = 0; i < record.actions.size(); i++) {
            if (i) line += ", ";
            line += record.actions[i];
        }
    }
    if (record.frame.present) {
        line += " Frame: {x: " + std::to_string((int)std::round(record.frame.x)) +
            ", y: " + std::to_string((int)std::round(record.frame.y)) +
            ", width: " + std::to_string((int)std::round(record.frame.width)) +
            ", height: " + std::to_string((int)std::round(record.frame.height)) + "}";
    }
    lines.push_back(line);
}

static void renderTreeVisit(IUIAutomation* uia, IUIAutomationElement* node, int depth, const Frame& windowFrame,
                            std::set<std::string>& visited, std::vector<ElementRecord>& records,
                            std::vector<std::string>& lines,
                            std::map<std::string, IUIAutomationElement*>* liveElements = nullptr) {
    if (!node || records.size() >= MAX_TREE_ELEMENTS || depth > MAX_TREE_DEPTH) return;
    std::vector<int> runtime = getRuntimeId(node);
    std::string runtimeKey = runtimeIdKey(runtime);
    if (runtimeKey.empty()) runtimeKey = std::to_string((uintptr_t)node);
    if (!visited.insert(runtimeKey).second) return;

    int index = (int)records.size();
    ElementRecord record = elementRecord(node, index, windowFrame);
    records.push_back(record);
    appendTreeLine(record, depth, lines);
    if (liveElements && !runtimeKey.empty()) {
        node->AddRef();
        (*liveElements)[runtimeKey] = node;
    }

    IUIAutomationCondition* condition = nullptr;
    IUIAutomationElementArray* children = nullptr;
    if (SUCCEEDED(uia->CreateTrueCondition(&condition)) &&
        SUCCEEDED(node->FindAll(TreeScope_Children, condition, &children)) && children) {
        int length = 0;
        children->get_Length(&length);
        for (int i = 0; i < length; i++) {
            IUIAutomationElement* child = nullptr;
            if (SUCCEEDED(children->GetElement(i, &child))) {
                renderTreeVisit(uia, child, depth + 1, windowFrame, visited, records, lines, liveElements);
            }
            safeRelease(child);
        }
    }
    safeRelease(children);
    safeRelease(condition);
}

static int pngEncoderClsid(CLSID* clsid) {
    UINT num = 0, size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (!size) return -1;
    std::vector<BYTE> buffer(size);
    Gdiplus::ImageCodecInfo* codecs = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buffer.data());
    Gdiplus::GetImageEncoders(num, size, codecs);
    for (UINT i = 0; i < num; i++) {
        if (wcscmp(codecs[i].MimeType, L"image/png") == 0) {
            *clsid = codecs[i].Clsid;
            return (int)i;
        }
    }
    return -1;
}

static std::string base64Encode(const std::vector<BYTE>& bytes) {
    static const char* table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((bytes.size() + 2) / 3) * 4);
    for (size_t i = 0; i < bytes.size(); i += 3) {
        unsigned value = bytes[i] << 16;
        if (i + 1 < bytes.size()) value |= bytes[i + 1] << 8;
        if (i + 2 < bytes.size()) value |= bytes[i + 2];
        out.push_back(table[(value >> 18) & 63]);
        out.push_back(table[(value >> 12) & 63]);
        out.push_back(i + 1 < bytes.size() ? table[(value >> 6) & 63] : '=');
        out.push_back(i + 2 < bytes.size() ? table[value & 63] : '=');
    }
    return out;
}

static std::string encodeBitmapPngBase64(HBITMAP bitmap, int* widthOut = nullptr, int* heightOut = nullptr) {
    std::string out;
    Gdiplus::Bitmap gdipBitmap(bitmap, NULL);
    UINT sourceWidth = gdipBitmap.GetWidth();
    UINT sourceHeight = gdipBitmap.GetHeight();
    UINT outputWidth = sourceWidth;
    UINT outputHeight = sourceHeight;
    std::unique_ptr<Gdiplus::Bitmap> scaled;
    int longEdge = (int)std::max(sourceWidth, sourceHeight);
    if (longEdge > screenshotLongEdgeCapPx) {
        double scale = (double)screenshotLongEdgeCapPx / (double)longEdge;
        outputWidth = (UINT)std::max(1.0, std::round(sourceWidth * scale));
        outputHeight = (UINT)std::max(1.0, std::round(sourceHeight * scale));
        scaled.reset(new Gdiplus::Bitmap(outputWidth, outputHeight, PixelFormat32bppARGB));
        Gdiplus::Graphics graphics(scaled.get());
        graphics.SetCompositingMode(Gdiplus::CompositingModeSourceCopy);
        graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
        graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);
        graphics.DrawImage(&gdipBitmap, 0, 0, outputWidth, outputHeight);
    }
    Gdiplus::Bitmap* encodedBitmap = scaled ? scaled.get() : &gdipBitmap;
    CLSID clsid = {};
    IStream* stream = nullptr;
    if (pngEncoderClsid(&clsid) >= 0 && SUCCEEDED(CreateStreamOnHGlobal(NULL, TRUE, &stream))) {
        if (encodedBitmap->Save(stream, &clsid, NULL) == Gdiplus::Ok) {
            STATSTG stat = {};
            if (SUCCEEDED(stream->Stat(&stat, STATFLAG_NONAME))) {
                LARGE_INTEGER zero = {};
                stream->Seek(zero, STREAM_SEEK_SET, NULL);
                std::vector<BYTE> bytes((size_t)stat.cbSize.QuadPart);
                ULONG read = 0;
                if (SUCCEEDED(stream->Read(bytes.data(), (ULONG)bytes.size(), &read))) {
                    bytes.resize(read);
                    out = base64Encode(bytes);
                }
            }
        }
    }
    safeRelease(stream);
    if (!out.empty()) {
        if (widthOut) *widthOut = (int)outputWidth;
        if (heightOut) *heightOut = (int)outputHeight;
    }
    return out;
}

static bool sampledBitmapLooksBlack(HDC dc, int width, int height) {
    int sampleCount = 0;
    int visibleCount = 0;
    int xStep = std::max(1, width / 20);
    int yStep = std::max(1, height / 20);
    for (int y = 0; y < height; y += yStep) {
        for (int x = 0; x < width; x += xStep) {
            COLORREF pixel = GetPixel(dc, x, y);
            if (pixel == CLR_INVALID) continue;
            sampleCount++;
            int brightness = (int)GetRValue(pixel) + (int)GetGValue(pixel) + (int)GetBValue(pixel);
            if (brightness > 36) visibleCount++;
        }
    }
    return sampleCount > 0 && visibleCount == 0;
}

static bool rectsOverlapEnough(const RECT& a, const RECT& b) {
    RECT intersection = {};
    if (!IntersectRect(&intersection, &a, &b)) return false;
    LONG width = intersection.right - intersection.left;
    LONG height = intersection.bottom - intersection.top;
    return width > 16 && height > 16;
}

static bool isWindowLikelyOccluded(HWND hwnd, const Frame& bounds) {
    if (!hwnd || !bounds.present) return false;
    RECT target = {
        (LONG)std::round(bounds.x),
        (LONG)std::round(bounds.y),
        (LONG)std::round(bounds.x + bounds.width),
        (LONG)std::round(bounds.y + bounds.height),
    };
    for (HWND candidate = GetTopWindow(NULL); candidate; candidate = GetWindow(candidate, GW_HWNDNEXT)) {
        if (candidate == hwnd) return false;
        if (!IsWindowVisible(candidate)) continue;
        RECT rect = {};
        if (!GetWindowRect(candidate, &rect) || rect.right <= rect.left || rect.bottom <= rect.top) continue;
        if (rectsOverlapEnough(target, rect)) return true;
    }
    return false;
}

static std::string captureScreenRegionPngBase64(const Frame& bounds, int* widthOut, int* heightOut, bool* blankOut = nullptr) {
    if (blankOut) *blankOut = false;
    if (!bounds.present || bounds.width <= 0 || bounds.height <= 0) return "";
    int width = std::max(1, (int)std::round(bounds.width));
    int height = std::max(1, (int)std::round(bounds.height));
    HDC screen = GetDC(NULL);
    HDC mem = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, width, height);
    HGDIOBJ old = SelectObject(mem, bitmap);
    BOOL ok = BitBlt(mem, 0, 0, width, height, screen, (int)std::round(bounds.x), (int)std::round(bounds.y), SRCCOPY | CAPTUREBLT);

    std::string out;
    if (ok && sampledBitmapLooksBlack(mem, width, height)) {
        // Exclusive-fullscreen DirectX, protected content and locked or
        // switched desktops all come back as solid black. Never hand that
        // to the agent as if it were the window.
        if (blankOut) *blankOut = true;
    } else if (ok) {
        out = encodeBitmapPngBase64(bitmap, widthOut, heightOut);
    }

    SelectObject(mem, old);
    DeleteObject(bitmap);
    DeleteDC(mem);
    ReleaseDC(NULL, screen);
    return out;
}

static std::string capturePrintWindowPngBase64(HWND hwnd, const Frame& bounds, int* widthOut, int* heightOut) {
    if (!hwnd || !bounds.present || bounds.width <= 0 || bounds.height <= 0) return "";
    int width = std::max(1, (int)std::round(bounds.width));
    int height = std::max(1, (int)std::round(bounds.height));
    HDC screen = GetDC(NULL);
    HDC mem = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, width, height);
    HGDIOBJ old = SelectObject(mem, bitmap);
    RECT fill = {0, 0, width, height};
    FillRect(mem, &fill, (HBRUSH)GetStockObject(BLACK_BRUSH));
    BOOL ok = PrintWindow(hwnd, mem, PW_RENDERFULLCONTENT);
    if (!ok) ok = PrintWindow(hwnd, mem, 0);

    std::string out;
    if (ok && !sampledBitmapLooksBlack(mem, width, height)) {
        out = encodeBitmapPngBase64(bitmap, widthOut, heightOut);
    }

    SelectObject(mem, old);
    DeleteObject(bitmap);
    DeleteDC(mem);
    ReleaseDC(NULL, screen);
    return out;
}

static std::string captureWindowPngBase64(HWND hwnd, const Frame& bounds, std::string* methodOut = nullptr,
                                          int* widthOut = nullptr, int* heightOut = nullptr, bool* blankOut = nullptr) {
    if (blankOut) *blankOut = false;
    std::string out = capturePrintWindowPngBase64(hwnd, bounds, widthOut, heightOut);
    if (!out.empty()) {
        if (methodOut) *methodOut = "printwindow";
        return out;
    }
    if (methodOut) *methodOut = "bitblt";
    return captureScreenRegionPngBase64(bounds, widthOut, heightOut, blankOut);
}

static bool frameOnAnyMonitor(const Frame& bounds) {
    if (!bounds.present || bounds.width <= 0 || bounds.height <= 0) return false;
    RECT rect = {
        (LONG)std::round(bounds.x),
        (LONG)std::round(bounds.y),
        (LONG)std::round(bounds.x + bounds.width),
        (LONG)std::round(bounds.y + bounds.height),
    };
    return MonitorFromRect(&rect, MONITOR_DEFAULTTONULL) != NULL;
}

static std::wstring focusedSummary(IUIAutomation* uia, DWORD pid) {
    IUIAutomationElement* focused = nullptr;
    std::wstring out;
    if (SUCCEEDED(uia->GetFocusedElement(&focused)) && focused) {
        int focusedPid = 0;
        if (SUCCEEDED(focused->get_CurrentProcessId(&focusedPid)) && (DWORD)focusedPid == pid) {
            std::wstring role = getBstrProperty(&IUIAutomationElement::get_CurrentLocalizedControlType, focused);
            std::wstring name = getBstrProperty(&IUIAutomationElement::get_CurrentName, focused);
            out = name.empty() ? role : role + L" " + name;
        }
    }
    safeRelease(focused);
    return out;
}

static std::wstring selectedText(IUIAutomation* uia, DWORD pid) {
    IUIAutomationElement* focused = nullptr;
    std::wstring out;
    if (FAILED(uia->GetFocusedElement(&focused)) || !focused) return out;
    int focusedPid = 0;
    if (FAILED(focused->get_CurrentProcessId(&focusedPid)) || (DWORD)focusedPid != pid) {
        safeRelease(focused);
        return out;
    }
    IUIAutomationTextPattern* text = getPattern<IUIAutomationTextPattern>(focused, UIA_TextPatternId);
    if (text) {
        IUIAutomationTextRangeArray* ranges = nullptr;
        if (SUCCEEDED(text->GetSelection(&ranges)) && ranges) {
            int length = 0;
            ranges->get_Length(&length);
            if (length > 0) {
                IUIAutomationTextRange* range = nullptr;
                if (SUCCEEDED(ranges->GetElement(0, &range)) && range) {
                    BSTR bstr = nullptr;
                    if (SUCCEEDED(range->GetText(2048, &bstr))) out = bstrToWstring(bstr);
                    if (bstr) SysFreeString(bstr);
                }
                safeRelease(range);
            }
        }
        safeRelease(ranges);
    }
    safeRelease(text);
    safeRelease(focused);
    return out;
}

class TargetEventTracker : public IUIAutomationStructureChangedEventHandler,
                           public IUIAutomationPropertyChangedEventHandler,
                           public IUIAutomationEventHandler {
public:
    std::atomic<ULONG> references{1};
    std::atomic<unsigned long long> revision{0};
    std::atomic<unsigned long long> eventCount{0};
    std::atomic<unsigned long long> lastEventTickMs{0};

    void recordMutation() {
        revision.fetch_add(1, std::memory_order_relaxed);
        eventCount.fetch_add(1, std::memory_order_relaxed);
        lastEventTickMs.store(GetTickCount64(), std::memory_order_relaxed);
    }

    void invalidateForAction() {
        revision.fetch_add(1, std::memory_order_relaxed);
        lastEventTickMs.store(GetTickCount64(), std::memory_order_relaxed);
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
        if (!object) return E_POINTER;
        if (riid == __uuidof(IUnknown) || riid == __uuidof(IUIAutomationStructureChangedEventHandler)) {
            *object = static_cast<IUIAutomationStructureChangedEventHandler*>(this);
        } else if (riid == __uuidof(IUIAutomationPropertyChangedEventHandler)) {
            *object = static_cast<IUIAutomationPropertyChangedEventHandler*>(this);
        } else if (riid == __uuidof(IUIAutomationEventHandler)) {
            *object = static_cast<IUIAutomationEventHandler*>(this);
        } else {
            *object = nullptr;
            return E_NOINTERFACE;
        }
        AddRef();
        return S_OK;
    }

    ULONG STDMETHODCALLTYPE AddRef() override { return references.fetch_add(1) + 1; }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG remaining = references.fetch_sub(1) - 1;
        if (!remaining) delete this;
        return remaining;
    }
    HRESULT STDMETHODCALLTYPE HandleStructureChangedEvent(
        IUIAutomationElement*, StructureChangeType, SAFEARRAY*) override {
        recordMutation();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE HandlePropertyChangedEvent(
        IUIAutomationElement*, PROPERTYID, VARIANT) override {
        recordMutation();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE HandleAutomationEvent(IUIAutomationElement*, EVENTID) override {
        recordMutation();
        return S_OK;
    }
};

// The UI framework that draws a window decides which background input it
// accepts: posted messages, pen/touch injection, or only UI Automation.
enum class Framework {
    Win32,
    Chromium,
    ChromiumEmbedded,
    Wpf,
    Tk,
    XamlUwp,
    WinUI3,
    Gtk,
    LibreOffice,
    DelphiVcl,
};

static std::string frameworkId(Framework framework) {
    switch (framework) {
    case Framework::Chromium: return "chromium";
    case Framework::ChromiumEmbedded: return "chromium_embedded";
    case Framework::Wpf: return "wpf";
    case Framework::Tk: return "tk";
    case Framework::XamlUwp: return "xaml";
    case Framework::WinUI3: return "winui3";
    case Framework::Gtk: return "gtk";
    case Framework::LibreOffice: return "libreoffice";
    case Framework::DelphiVcl: return "delphi_vcl";
    case Framework::Win32: break;
    }
    return "win32";
}

static std::string frameworkLabel(Framework framework) {
    switch (framework) {
    case Framework::Chromium: return "a Chromium/Electron window";
    case Framework::ChromiumEmbedded: return "a Chromium view (CEF/WebView2) embedded in the app";
    case Framework::Wpf: return "a WPF window";
    case Framework::Tk: return "a Tk window (Tkinter, IDLE)";
    case Framework::XamlUwp: return "a UWP/XAML window";
    case Framework::WinUI3: return "a WinUI 3 window";
    case Framework::Gtk: return "a GTK window";
    case Framework::LibreOffice: return "a LibreOffice window";
    case Framework::DelphiVcl: return "a Delphi VCL window";
    case Framework::Win32: break;
    }
    return "a Win32 window";
}

struct TargetState {
    WindowProcess process;
    IUIAutomationElement* root = nullptr;
    TargetEventTracker* tracker = nullptr;
    std::map<std::string, IUIAutomationElement*> liveElements;
    Snapshot cachedSnapshot;
    bool hasSnapshot = false;
    unsigned long long materializedRevision = 0;
    unsigned long long pendingBaselineRevision = 0;
    unsigned long long pendingBaselineEventCount = 0;
    unsigned long long lastActionBaselineEventCount = 0;
    int pendingActionCount = 0;
    bool visualContextNeeded = false;
    bool handlersInstalled = false;
    // What kind of surface the window is, from its child windows and the
    // last materialized tree. Decides which background input it takes.
    bool surfaceKnown = false;
    bool chromium = false;
    bool chromiumTopLevel = false;
    Framework framework = Framework::Win32;
    int contentElementCount = -1;
    bool accessibilityWakeAttempted = false;
    std::string accessibilityWake = "not_needed";

    void clearLiveElements() {
        for (auto& item : liveElements) safeRelease(item.second);
        liveElements.clear();
    }
};

static std::map<long long, std::unique_ptr<TargetState>> targetStates;

static void detachTargetHandlers(IUIAutomation* uia, TargetState& state) {
    if (!state.handlersInstalled || !state.root || !state.tracker) return;
    uia->RemoveStructureChangedEventHandler(
        state.root,
        static_cast<IUIAutomationStructureChangedEventHandler*>(state.tracker));
    uia->RemovePropertyChangedEventHandler(
        state.root,
        static_cast<IUIAutomationPropertyChangedEventHandler*>(state.tracker));
    const EVENTID events[] = {
        UIA_LayoutInvalidatedEventId,
        UIA_Text_TextChangedEventId,
        UIA_Selection_InvalidatedEventId,
    };
    for (EVENTID eventId : events) {
        uia->RemoveAutomationEventHandler(
            eventId,
            state.root,
            static_cast<IUIAutomationEventHandler*>(state.tracker));
    }
    state.handlersInstalled = false;
}

static void releaseTargetState(IUIAutomation* uia, TargetState& state) {
    detachTargetHandlers(uia, state);
    state.clearLiveElements();
    safeRelease(state.root);
    if (state.tracker) state.tracker->Release();
    state.tracker = nullptr;
}

static void releaseAllTargetStates(IUIAutomation* uia) {
    for (auto& item : targetStates) releaseTargetState(uia, *item.second);
    targetStates.clear();
}

static bool validateTargetState(TargetState& state, const WindowProcess& process) {
    if (!state.root || !IsWindow(process.hwnd) || process.hwnd != state.process.hwnd || process.pid != state.process.pid) {
        return false;
    }
    int rootPid = 0;
    UIA_HWND rootHwnd = NULL;
    return SUCCEEDED(state.root->get_CurrentProcessId(&rootPid)) &&
           SUCCEEDED(state.root->get_CurrentNativeWindowHandle(&rootHwnd)) &&
           (DWORD)rootPid == process.pid && (HWND)(intptr_t)rootHwnd == process.hwnd;
}

static void installTargetHandlers(IUIAutomation* uia, TargetState& state) {
    state.tracker = new TargetEventTracker();
    HRESULT structureResult = uia->AddStructureChangedEventHandler(
        state.root,
        TreeScope_Subtree,
        nullptr,
        static_cast<IUIAutomationStructureChangedEventHandler*>(state.tracker));
    PROPERTYID properties[] = {
        UIA_NamePropertyId,
        UIA_ValueValuePropertyId,
        UIA_BoundingRectanglePropertyId,
        UIA_IsOffscreenPropertyId,
        UIA_IsEnabledPropertyId,
        UIA_HasKeyboardFocusPropertyId,
        UIA_ExpandCollapseExpandCollapseStatePropertyId,
        UIA_ToggleToggleStatePropertyId,
        UIA_SelectionItemIsSelectedPropertyId,
    };
    HRESULT propertyResult = uia->AddPropertyChangedEventHandlerNativeArray(
        state.root,
        TreeScope_Subtree,
        nullptr,
        static_cast<IUIAutomationPropertyChangedEventHandler*>(state.tracker),
        properties,
        (int)(sizeof(properties) / sizeof(properties[0])));
    const EVENTID events[] = {
        UIA_LayoutInvalidatedEventId,
        UIA_Text_TextChangedEventId,
        UIA_Selection_InvalidatedEventId,
    };
    bool automationInstalled = false;
    for (EVENTID eventId : events) {
        if (SUCCEEDED(uia->AddAutomationEventHandler(
                eventId,
                state.root,
                TreeScope_Subtree,
                nullptr,
                static_cast<IUIAutomationEventHandler*>(state.tracker)))) {
            automationInstalled = true;
        }
    }
    state.handlersInstalled = SUCCEEDED(structureResult) || SUCCEEDED(propertyResult) || automationInstalled;
}

static TargetState& targetStateFor(IUIAutomation* uia, const WindowProcess& process) {
    long long key = hwndValue(process.hwnd);
    auto existing = targetStates.find(key);
    if (existing != targetStates.end() && !validateTargetState(*existing->second, process)) {
        releaseTargetState(uia, *existing->second);
        targetStates.erase(existing);
        existing = targetStates.end();
    }
    if (existing != targetStates.end()) {
        existing->second->process = process;
        return *existing->second;
    }

    std::unique_ptr<TargetState> state(new TargetState());
    state->process = process;
    if (FAILED(uia->ElementFromHandle(process.hwnd, &state->root)) || !state->root) {
        throw std::runtime_error("No top-level UI Automation window is available for " + toUtf8(process.processName));
    }
    installTargetHandlers(uia, *state);
    TargetState& result = *state;
    targetStates[key] = std::move(state);
    return result;
}

struct AdaptiveSettle {
    bool observed = false;
    int waitedMs = 0;
    int eventCount = 0;
    bool timedOut = false;
    unsigned long long baselineRevision = 0;
    unsigned long long finalRevision = 0;
    int pendingActionCount = 0;
};

static bool targetShowsLoading(IUIAutomation* uia, TargetState& state) {
    VARIANT value;
    VariantInit(&value);
    value.vt = VT_I4;
    value.lVal = UIA_ProgressBarControlTypeId;
    IUIAutomationCondition* condition = nullptr;
    IUIAutomationElement* progress = nullptr;
    bool loading = false;
    if (SUCCEEDED(uia->CreatePropertyCondition(UIA_ControlTypePropertyId, value, &condition)) && condition &&
        SUCCEEDED(state.root->FindFirst(TreeScope_Subtree, condition, &progress)) && progress) {
        BOOL offscreen = TRUE;
        loading = FAILED(progress->get_CurrentIsOffscreen(&offscreen)) || !offscreen;
    }
    safeRelease(progress);
    safeRelease(condition);
    VariantClear(&value);
    return loading;
}

static AdaptiveSettle waitForTargetQuiet(
    IUIAutomation* uia,
    TargetState& state,
    unsigned long long baselineRevision,
    unsigned long long baselineEventCount) {
    AdaptiveSettle settle;
    settle.observed = state.handlersInstalled;
    settle.baselineRevision = baselineRevision;
    settle.pendingActionCount = state.pendingActionCount;
    unsigned long long start = GetTickCount64();
    unsigned long long deadline = start + adaptiveSettleTimeoutMs;
    unsigned long long nextLoadingCheck = start;
    bool loading = false;
    const unsigned long long graceDeadline = start + (state.pendingActionCount > 0 ? 700 : 60);
    while (GetTickCount64() < graceDeadline) {
        // Require provider events after the latest action, not an earlier
        // batched action or the synthetic invalidateForAction revision.
        if (state.pendingActionCount > 0 && state.tracker &&
            state.tracker->eventCount.load() > state.lastActionBaselineEventCount) break;
        Sleep(5);
    }
    while (true) {
        unsigned long long now = GetTickCount64();
        unsigned long long revision = state.tracker ? state.tracker->revision.load() : baselineRevision;
        unsigned long long lastEvent = state.tracker ? state.tracker->lastEventTickMs.load() : start;
        if (now >= nextLoadingCheck) {
            loading = targetShowsLoading(uia, state);
            nextLoadingCheck = now + 100;
        }
        bool changed = revision > baselineRevision;
        bool quiet = !changed || now >= lastEvent + adaptiveQuietMs;
        if (quiet && !loading) break;
        if (now >= deadline) {
            settle.timedOut = true;
            break;
        }
        Sleep(20);
    }
    settle.waitedMs = (int)(GetTickCount64() - start);
    settle.finalRevision = state.tracker ? state.tracker->revision.load() : baselineRevision;
    unsigned long long totalEvents = state.tracker ? state.tracker->eventCount.load() : baselineEventCount;
    settle.eventCount = (int)(totalEvents >= baselineEventCount ? totalEvents - baselineEventCount : 0);
    return settle;
}

static void captureSnapshotImage(Snapshot& snapshot, HWND hwnd) {
    if (IsIconic(hwnd)) {
        snapshot.captureMethod = "none";
        snapshot.captureBlank = true;
        snapshot.warnings.push_back(
            "No screenshot: the window is minimized, so Windows has no pixels for it. Foreground input "
            "(delivery: \"foreground\") restores it; observe again afterwards.");
        return;
    }
    bool blank = false;
    snapshot.screenshotBase64 = captureWindowPngBase64(
        hwnd,
        snapshot.windowBounds,
        &snapshot.captureMethod,
        &snapshot.screenshotWidth,
        &snapshot.screenshotHeight,
        &blank);
    if (snapshot.screenshotBase64.empty()) {
        snapshot.screenshotWidth = 0;
        snapshot.screenshotHeight = 0;
        snapshot.captureBlank = true;
        std::string method = snapshot.captureMethod;
        snapshot.captureMethod = "none";
        if (!frameOnAnyMonitor(snapshot.windowBounds)) {
            snapshot.warnings.push_back(
                "No screenshot: the window is off-screen and does not render its contents for capture. "
                "Bring it onto a monitor (foreground input does this) and observe again.");
        } else if (blank) {
            snapshot.warnings.push_back(
                "No screenshot: Windows returned only black pixels for this window (both PrintWindow and "
                "screen capture). Typical causes: exclusive-fullscreen DirectX/OpenGL, protected video, or "
                "a locked or secure desktop (UAC prompt). Switching the app to borderless/windowed mode "
                "usually fixes capture.");
        } else {
            snapshot.warnings.push_back("No screenshot: Windows could not capture this window (" + method + " failed).");
        }
        return;
    }
    snapshot.captureOccluded = snapshot.captureMethod == "bitblt" && isWindowLikelyOccluded(hwnd, snapshot.windowBounds);
    if (snapshot.captureOccluded) {
        snapshot.warnings.push_back("Screenshot used screen-region capture while another window appears to overlap the target; pixels may include the covering window.");
    }
}

struct ChildWindowScan {
    bool chromium = false;
    bool winUiIsland = false;
    bool xamlIsland = false;
    std::vector<HWND> chromiumHosts;
};

static bool isChromiumClassName(const std::wstring& className) {
    return className.rfind(L"Chrome_", 0) == 0 || className.rfind(L"Cef", 0) == 0;
}

static BOOL CALLBACK scanChildWindowProc(HWND child, LPARAM lParam) {
    ChildWindowScan* scan = reinterpret_cast<ChildWindowScan*>(lParam);
    std::wstring className = classNameForWindow(child);
    if (className == L"Microsoft.UI.Content.DesktopChildSiteBridge") scan->winUiIsland = true;
    if (className == L"Windows.UI.Composition.DesktopWindowContentBridge" || className == L"Windows.UI.Core.CoreWindow" ||
        className.rfind(L"DesktopWindowXamlSource", 0) == 0) {
        scan->xamlIsland = true;
    }
    if (isChromiumClassName(className)) {
        scan->chromium = true;
        if (className == L"Chrome_RenderWidgetHostHWND" || className.rfind(L"Chrome_WidgetWin", 0) == 0) {
            scan->chromiumHosts.push_back(child);
        }
    }
    return scan->chromiumHosts.size() < 32 ? TRUE : FALSE;
}

static ChildWindowScan scanChildWindows(HWND hwnd) {
    ChildWindowScan scan;
    if (hwnd) EnumChildWindows(hwnd, scanChildWindowProc, reinterpret_cast<LPARAM>(&scan));
    return scan;
}

static void refreshSurfaceIdentity(TargetState& state) {
    HWND hwnd = state.process.hwnd;
    std::wstring topClass = classNameForWindow(hwnd);
    std::wstring processName = lowerW(state.process.processName);
    ChildWindowScan scan = scanChildWindows(hwnd);
    state.chromiumTopLevel = topClass.rfind(L"Chrome_WidgetWin", 0) == 0;
    state.chromium = state.chromiumTopLevel || isChromiumClassName(topClass) || scan.chromium ||
        processName == L"chrome" || processName == L"msedge" || processName == L"electron";
    std::wstring lowerClass = lowerW(topClass);
    if (state.chromiumTopLevel) state.framework = Framework::Chromium;
    else if (topClass == L"WinUIDesktopWin32WindowClass" || scan.winUiIsland) state.framework = Framework::WinUI3;
    else if (topClass == L"ApplicationFrameWindow" || topClass == L"Windows.UI.Core.CoreWindow" || scan.xamlIsland) {
        state.framework = Framework::XamlUwp;
    }
    else if (topClass.rfind(L"HwndWrapper[", 0) == 0) state.framework = Framework::Wpf;
    else if (topClass == L"TkTopLevel" || topClass.rfind(L"TkTopLevel.", 0) == 0) state.framework = Framework::Tk;
    else if (topClass.rfind(L"gdkWindow", 0) == 0 || topClass.rfind(L"gdkSurface", 0) == 0) state.framework = Framework::Gtk;
    else if (topClass.rfind(L"SAL", 0) == 0) state.framework = Framework::LibreOffice;
    else if (state.chromium) state.framework = Framework::ChromiumEmbedded;
    else if (lowerClass.find(L"tapplication") != std::wstring::npos || lowerClass.find(L"vcl") != std::wstring::npos ||
             processName.find(L"vcl") != std::wstring::npos) {
        state.framework = Framework::DelphiVcl;
    } else {
        state.framework = Framework::Win32;
    }
    state.surfaceKnown = true;
}

static bool isWindowFullscreen(HWND hwnd) {
    if (!hwnd || !IsWindow(hwnd) || IsIconic(hwnd)) return false;
    HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL);
    if (!monitor) return false;
    MONITORINFO info = {};
    info.cbSize = sizeof(info);
    RECT rect = {};
    if (!GetMonitorInfoW(monitor, &info) || !GetWindowRect(hwnd, &rect)) return false;
    return rect.left <= info.rcMonitor.left && rect.top <= info.rcMonitor.top &&
        rect.right >= info.rcMonitor.right && rect.bottom >= info.rcMonitor.bottom;
}

// Elements that are actual content: inside the client area and not just the
// window, panes, the title bar and its caption buttons, or scroll chrome.
static int countContentElements(HWND hwnd, const Snapshot& snapshot) {
    RECT client = {};
    if (!hwnd || !GetClientRect(hwnd, &client)) return (int)snapshot.elements.size();
    MapWindowPoints(hwnd, NULL, reinterpret_cast<POINT*>(&client), 2);
    int count = 0;
    for (const ElementRecord& record : snapshot.elements) {
        if (record.index == 0 || !record.frame.present) continue;
        if (record.frame.width < 2 || record.frame.height < 2) continue;
        const std::wstring& type = record.controlType;
        if (type == L"ControlType.Window" || type == L"ControlType.Pane" || type == L"ControlType.TitleBar" ||
            type == L"ControlType.MenuBar" || type == L"ControlType.ScrollBar" || type == L"ControlType.Thumb") {
            continue;
        }
        double originX = snapshot.windowBounds.present ? snapshot.windowBounds.x : 0;
        double originY = snapshot.windowBounds.present ? snapshot.windowBounds.y : 0;
        double centerX = originX + record.frame.x + record.frame.width / 2.0;
        double centerY = originY + record.frame.y + record.frame.height / 2.0;
        if (centerX < client.left || centerX >= client.right || centerY < client.top || centerY >= client.bottom) continue;
        count++;
    }
    return count;
}

// Chromium (Chrome, Edge, Electron, CEF) builds its web accessibility tree
// only once an assistive technology asks for it. Ask the way a screen reader
// does: fetch the MSAA root of each Chromium host window and read a few
// properties, then let UIA see the result. This changes nothing in the app
// beyond turning its accessibility tree on; an app that disables renderer
// accessibility (some CEF builds) simply stays empty.
static void wakeChromiumAccessibility(IUIAutomation* uia, HWND hwnd) {
    ChildWindowScan scan = scanChildWindows(hwnd);
    std::vector<HWND> hosts = scan.chromiumHosts;
    hosts.insert(hosts.begin(), hwnd);
    VARIANT self;
    VariantInit(&self);
    self.vt = VT_I4;
    self.lVal = CHILDID_SELF;
    for (HWND host : hosts) {
        IAccessible* accessible = nullptr;
        if (SUCCEEDED(AccessibleObjectFromWindow(host, (DWORD)OBJID_CLIENT, IID_IAccessible,
                                                 reinterpret_cast<void**>(&accessible))) && accessible) {
            long childCount = 0;
            accessible->get_accChildCount(&childCount);
            BSTR name = nullptr;
            if (SUCCEEDED(accessible->get_accName(self, &name)) && name) SysFreeString(name);
            VARIANT role;
            VariantInit(&role);
            if (SUCCEEDED(accessible->get_accRole(self, &role))) VariantClear(&role);
            if (childCount > 0) {
                long wanted = std::min<long>(childCount, 8);
                std::vector<VARIANT> children((size_t)wanted);
                for (VARIANT& child : children) VariantInit(&child);
                long obtained = 0;
                if (SUCCEEDED(AccessibleChildren(accessible, 0, wanted, children.data(), &obtained))) {
                    for (long i = 0; i < obtained; i++) {
                        if (children[(size_t)i].vt == VT_DISPATCH && children[(size_t)i].pdispVal) {
                            IAccessible* child = nullptr;
                            if (SUCCEEDED(children[(size_t)i].pdispVal->QueryInterface(
                                    IID_IAccessible, reinterpret_cast<void**>(&child))) && child) {
                                BSTR childName = nullptr;
                                if (SUCCEEDED(child->get_accName(self, &childName)) && childName) SysFreeString(childName);
                                child->Release();
                            }
                        }
                    }
                }
                for (VARIANT& child : children) VariantClear(&child);
            }
            accessible->Release();
        }
        IUIAutomationElement* element = nullptr;
        if (SUCCEEDED(uia->ElementFromHandle(host, &element)) && element) {
            BSTR name = nullptr;
            if (SUCCEEDED(element->get_CurrentName(&name)) && name) SysFreeString(name);
            IUIAutomationTreeWalker* walker = nullptr;
            if (SUCCEEDED(uia->get_RawViewWalker(&walker)) && walker) {
                IUIAutomationElement* first = nullptr;
                if (SUCCEEDED(walker->GetFirstChildElement(element, &first)) && first) {
                    BSTR firstName = nullptr;
                    if (SUCCEEDED(first->get_CurrentName(&firstName)) && firstName) SysFreeString(firstName);
                }
                safeRelease(first);
            }
            safeRelease(walker);
        }
        safeRelease(element);
    }
}

static Snapshot materializeSnapshot(IUIAutomation* uia, TargetState& state, const std::string& screenshotPolicy) {
    Snapshot snapshot;
    snapshot.appName = state.process.processName;
    snapshot.pid = state.process.pid;
    snapshot.windowId = hwndValue(state.process.hwnd);
    snapshot.windowTitle = getWindowText(state.process.hwnd);
    snapshot.windowBounds = windowBounds(state.process.hwnd, state.root);
    snapshot.appInstructions = appInstructionsFor(state.process.processName);
    snapshot.cacheKey = "hwnd:" + std::to_string(snapshot.windowId);
    snapshot.screenshotPolicy = screenshotPolicy;
    snapshot.uiaEventsObserved = state.handlersInstalled;
    auto walkTree = [&]() {
        state.clearLiveElements();
        snapshot.elements.clear();
        snapshot.treeLines.clear();
        std::set<std::string> visited;
        renderTreeVisit(
            uia,
            state.root,
            0,
            snapshot.windowBounds,
            visited,
            snapshot.elements,
            snapshot.treeLines,
            &state.liveElements);
    };
    walkTree();
    refreshSurfaceIdentity(state);
    state.contentElementCount = countContentElements(state.process.hwnd, snapshot);
    if (state.chromium && state.contentElementCount == 0 && !state.accessibilityWakeAttempted) {
        state.accessibilityWakeAttempted = true;
        wakeChromiumAccessibility(uia, state.process.hwnd);
        unsigned long long wakeDeadline = GetTickCount64() + 2000;
        while (GetTickCount64() < wakeDeadline) {
            Sleep(250);
            walkTree();
            state.contentElementCount = countContentElements(state.process.hwnd, snapshot);
            if (state.contentElementCount > 0) break;
        }
        state.accessibilityWake = state.contentElementCount > 0 ? "woken" : "no_tree";
    } else if (state.chromium && state.contentElementCount > 0 && state.accessibilityWake == "no_tree") {
        state.accessibilityWake = "woken";
    }
    snapshot.contentElementCount = state.contentElementCount;
    snapshot.accessibilityWake = state.chromium ? state.accessibilityWake : "not_needed";
    snapshot.surfaceKind = state.chromium ? "chromium" : (state.contentElementCount == 0 ? "opaque" : "native");
    snapshot.framework = frameworkId(state.framework);
    snapshot.surfaceFullscreen = isWindowFullscreen(state.process.hwnd);
    snapshot.surfaceMinimized = IsIconic(state.process.hwnd) != FALSE;
    snapshot.focusedSummary = focusedSummary(uia, state.process.pid);
    snapshot.selectedText = selectedText(uia, state.process.pid);
    bool capture = screenshotPolicy == "always" ||
                   (screenshotPolicy == "auto" &&
                    (state.visualContextNeeded || snapshot.elements.size() < 3 || state.contentElementCount == 0));
    if (capture) captureSnapshotImage(snapshot, state.process.hwnd);
    unsigned long long revision = state.tracker ? state.tracker->revision.load() : 0;
    snapshot.revision = revision;
    snapshot.materializedRevision = revision;
    snapshot.pendingActionCount = state.pendingActionCount;
    snapshot.elementCacheValidated = true;
    state.materializedRevision = revision;
    state.cachedSnapshot = snapshot;
    state.hasSnapshot = true;
    return snapshot;
}

static Snapshot snapshotForTarget(IUIAutomation* uia, TargetState& state, const std::string& screenshotPolicy) {
    unsigned long long revision = state.tracker ? state.tracker->revision.load() : 0;
    if (!state.hasSnapshot || state.materializedRevision != revision) {
        return materializeSnapshot(uia, state, screenshotPolicy);
    }
    Snapshot snapshot = state.cachedSnapshot;
    snapshot.cacheHit = true;
    snapshot.revision = revision;
    snapshot.materializedRevision = state.materializedRevision;
    snapshot.pendingActionCount = state.pendingActionCount;
    snapshot.screenshotPolicy = screenshotPolicy;
    snapshot.screenshotBase64.clear();
    snapshot.captureMethod.clear();
    snapshot.captureOccluded = false;
    snapshot.captureBlank = false;
    snapshot.surfaceFullscreen = isWindowFullscreen(state.process.hwnd);
    snapshot.surfaceMinimized = IsIconic(state.process.hwnd) != FALSE;
    snapshot.warnings.clear();
    snapshot.screenshotWidth = 0;
    snapshot.screenshotHeight = 0;
    bool capture = screenshotPolicy == "always" ||
                   (screenshotPolicy == "auto" && (state.visualContextNeeded || state.contentElementCount == 0));
    if (capture) captureSnapshotImage(snapshot, state.process.hwnd);
    return snapshot;
}

static Snapshot buildSnapshot(
    IUIAutomation* uia,
    const std::wstring& query,
    long long windowId = 0,
    const std::string& screenshotPolicy = "always",
    AdaptiveSettle* settleOut = nullptr) {
    WindowProcess process = resolveApp(uia, query, windowId);
    TargetState& state = targetStateFor(uia, process);
    AdaptiveSettle pendingSettle;
    bool settledPendingActions = false;
    if (state.pendingActionCount > 0) {
        pendingSettle = waitForTargetQuiet(
            uia,
            state,
            state.pendingBaselineRevision,
            state.pendingBaselineEventCount);
        settledPendingActions = true;
        if (settleOut) *settleOut = pendingSettle;
    }
    Snapshot snapshot = snapshotForTarget(uia, state, screenshotPolicy);
    if (settledPendingActions) {
        snapshot.settleWaitedMs = pendingSettle.waitedMs;
        snapshot.settleEventCount = pendingSettle.eventCount;
        snapshot.settleTimedOut = pendingSettle.timedOut;
        snapshot.settleBaselineRevision = pendingSettle.baselineRevision;
        snapshot.settleFinalRevision = pendingSettle.finalRevision;
    }
    state.pendingActionCount = 0;
    state.visualContextNeeded = false;
    return snapshot;
}

static std::vector<int> parseRuntimeId(const Json* element) {
    std::vector<int> out;
    if (!element) return out;
    const Json* runtime = element->get("runtimeId");
    if (!runtime || runtime->type != Json::Array) return out;
    for (const Json& value : runtime->arrayValue) {
        if (value.type == Json::Number) out.push_back((int)value.numberValue);
    }
    return out;
}

static Frame parseFrame(const Json* element) {
    Frame frame;
    if (!element) return frame;
    const Json* f = element->get("frame");
    if (!f || f->type != Json::Object) return frame;
    frame.present = true;
    frame.x = f->num("x");
    frame.y = f->num("y");
    frame.width = f->num("width");
    frame.height = f->num("height");
    return frame;
}

static bool sameRuntimeId(const std::vector<int>& left, const std::vector<int>& right) {
    return !left.empty() && left == right;
}

static void collectAllElements(IUIAutomation* uia, IUIAutomationElement* root, std::vector<IUIAutomationElement*>& out) {
    if (!root) return;
    root->AddRef();
    out.push_back(root);
    IUIAutomationCondition* condition = nullptr;
    IUIAutomationElementArray* descendants = nullptr;
    if (SUCCEEDED(uia->CreateTrueCondition(&condition)) &&
        SUCCEEDED(root->FindAll(TreeScope_Descendants, condition, &descendants)) && descendants) {
        int length = 0;
        descendants->get_Length(&length);
        for (int i = 0; i < length; i++) {
            IUIAutomationElement* element = nullptr;
            if (SUCCEEDED(descendants->GetElement(i, &element)) && element) out.push_back(element);
        }
    }
    safeRelease(descendants);
    safeRelease(condition);
}

static IUIAutomationElement* findElement(IUIAutomation* uia, IUIAutomationElement* root, const Json* recordJson) {
    if (!recordJson || recordJson->type != Json::Object) return nullptr;
    std::vector<int> wantedRuntime = parseRuntimeId(recordJson);
    std::wstring wantedAutomationId = toWide(recordJson->str("automationId"));
    std::wstring wantedName = toWide(recordJson->str("name"));
    std::wstring wantedType = toWide(recordJson->str("controlType"));
    std::vector<IUIAutomationElement*> all;
    collectAllElements(uia, root, all);
    for (IUIAutomationElement* element : all) {
        if (sameRuntimeId(getRuntimeId(element), wantedRuntime)) {
            for (IUIAutomationElement* other : all) if (other != element) other->Release();
            return element;
        }
    }
    for (IUIAutomationElement* element : all) {
        std::wstring automationId = getBstrProperty(&IUIAutomationElement::get_CurrentAutomationId, element);
        std::wstring name = getBstrProperty(&IUIAutomationElement::get_CurrentName, element);
        CONTROLTYPEID ctid = 0;
        std::wstring type;
        if (SUCCEEDED(element->get_CurrentControlType(&ctid))) type = controlTypeName(ctid);
        if (((!wantedAutomationId.empty() && wantedAutomationId == automationId) ||
             (!wantedName.empty() && wantedName == name)) &&
            wantedType == type) {
            for (IUIAutomationElement* other : all) if (other != element) other->Release();
            return element;
        }
    }
    for (IUIAutomationElement* element : all) element->Release();
    return nullptr;
}

static IUIAutomationElement* findValidatedCachedElement(TargetState& state, const Json* recordJson) {
    std::vector<int> wantedRuntime = parseRuntimeId(recordJson);
    if (wantedRuntime.empty()) return nullptr;
    auto cached = state.liveElements.find(runtimeIdKey(wantedRuntime));
    if (cached == state.liveElements.end() || !cached->second) return nullptr;
    int pid = 0;
    if (FAILED(cached->second->get_CurrentProcessId(&pid)) ||
        (DWORD)pid != state.process.pid ||
        !sameRuntimeId(getRuntimeId(cached->second), wantedRuntime)) {
        safeRelease(cached->second);
        state.liveElements.erase(cached);
        return nullptr;
    }
    cached->second->AddRef();
    return cached->second;
}

static POINT screenPointFromFrame(const Frame& local, const Frame& window) {
    POINT p = {};
    p.x = (LONG)std::round(window.x + local.x + local.width / 2.0);
    p.y = (LONG)std::round(window.y + local.y + local.height / 2.0);
    return p;
}

static LPARAM toLParam(int x, int y) {
    return (LPARAM)(((y & 0xffff) << 16) | (x & 0xffff));
}

static WPARAM toWheelWParam(int delta) {
    return (WPARAM)((delta & 0xffff) << 16);
}

static bool withinRoot(HWND root, HWND child) {
    return child && (root == child || IsChild(root, child) || GetAncestor(child, GA_ROOT) == root);
}

static HWND deepestChildFromPoint(HWND root, POINT screen) {
    HWND current = root;
    for (int depth = 0; depth < 16; depth++) {
        POINT client = screen;
        ScreenToClient(current, &client);
        HWND child = ChildWindowFromPointEx(current, client, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT);
        if (!child || child == current || !withinRoot(root, child)) return current;
        current = child;
    }
    return current;
}

static HWND resolveMessageTarget(HWND root, POINT screen, POINT* clientOut) {
    HWND target = deepestChildFromPoint(root, screen);
    *clientOut = screen;
    ScreenToClient(target, clientOut);
    return target;
}

static void postChecked(HWND target, UINT message, WPARAM wParam, LPARAM lParam, const char* what) {
    if (PostMessageW(target, message, wParam, lParam)) return;
    DWORD error = GetLastError();
    throw CodedError(
        error == ERROR_ACCESS_DENIED ? "uipi_blocked" : "input_refused",
        std::string("Windows refused to post the ") + what + " message to the window (" + win32ErrorText(error) +
        "), so the input was not delivered.");
}

static BOOL CALLBACK collectWindowThreadProc(HWND child, LPARAM lParam) {
    auto* threads = reinterpret_cast<std::vector<DWORD>*>(lParam);
    DWORD thread = GetWindowThreadProcessId(child, NULL);
    if (thread && std::find(threads->begin(), threads->end(), thread) == threads->end()) threads->push_back(thread);
    return threads->size() < 64 ? TRUE : FALSE;
}

// The child window that has keyboard focus inside `root`, across every UI
// thread that owns part of it (embedded renderers run on their own thread).
// Keyboard messages posted to a top-level window are not forwarded to the
// control inside it.
static HWND focusedDescendant(HWND root) {
    DWORD rootThread = GetWindowThreadProcessId(root, NULL);
    if (!rootThread) return NULL;
    std::vector<DWORD> threads = {rootThread};
    EnumChildWindows(root, collectWindowThreadProc, reinterpret_cast<LPARAM>(&threads));
    HWND best = NULL;
    int bestDepth = -1;
    for (DWORD thread : threads) {
        GUITHREADINFO info = {};
        info.cbSize = sizeof(info);
        if (!GetGUIThreadInfo(thread, &info) || !info.hwndFocus) continue;
        HWND focused = info.hwndFocus;
        if (focused == root || !IsChild(root, focused)) continue;
        int depth = 0;
        for (HWND current = focused; current && current != root && depth < 64; current = GetParent(current)) depth++;
        if (depth > bestDepth) {
            best = focused;
            bestDepth = depth;
        }
    }
    return best;
}

static HWND keyboardMessageTarget(HWND root) {
    HWND focused = focusedDescendant(root);
    return focused ? focused : root;
}

// Suspends the thread that owns a window while a click's messages are
// posted, so the thread sees move, press and release together without a
// real pointer move from the user in between.
class SuspendedWindowThread {
public:
    explicit SuspendedWindowThread(HWND hwnd) {
        DWORD threadId = GetWindowThreadProcessId(hwnd, NULL);
        if (!threadId || threadId == GetCurrentThreadId()) return;
        HANDLE handle = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT, FALSE, threadId);
        if (!handle) return;
        if (SuspendThread(handle) == (DWORD)-1) {
            CloseHandle(handle);
            return;
        }
        // SuspendThread is asynchronous; reading the context waits until the
        // thread has actually stopped.
        CONTEXT context = {};
        context.ContextFlags = CONTEXT_CONTROL;
        if (!GetThreadContext(handle, &context)) {
            ResumeThread(handle);
            CloseHandle(handle);
            return;
        }
        thread_ = handle;
    }
    ~SuspendedWindowThread() {
        if (!thread_) return;
        ResumeThread(thread_);
        CloseHandle(thread_);
    }
    SuspendedWindowThread(const SuspendedWindowThread&) = delete;
    SuspendedWindowThread& operator=(const SuspendedWindowThread&) = delete;

private:
    HANDLE thread_ = NULL;
};

static void sendMouseClick(HWND hwnd, POINT screen, const std::string& button, int count, bool holdTargetThread) {
    POINT client = {};
    HWND target = resolveMessageTarget(hwnd, screen, &client);
    UINT down = WM_LBUTTONDOWN, up = WM_LBUTTONUP, doubleDown = WM_LBUTTONDBLCLK;
    WPARAM downFlag = MK_LBUTTON;
    if (button == "right") {
        down = WM_RBUTTONDOWN;
        up = WM_RBUTTONUP;
        doubleDown = WM_RBUTTONDBLCLK;
        downFlag = MK_RBUTTON;
    } else if (button == "middle") {
        down = WM_MBUTTONDOWN;
        up = WM_MBUTTONUP;
        doubleDown = WM_MBUTTONDBLCLK;
        downFlag = MK_MBUTTON;
    }
    // Windows turns a second real press into a double-click message only for
    // classes that ask for it; posted presses are never converted.
    bool wantsDoubleClicks = (GetClassLongPtrW(target, GCL_STYLE) & CS_DBLCLKS) != 0;
    LPARAM lp = toLParam(client.x, client.y);
    for (int i = 0; i < std::max(1, count); i++) {
        UINT press = wantsDoubleClicks && i % 2 == 1 ? doubleDown : down;
        {
            std::unique_ptr<SuspendedWindowThread> hold;
            if (holdTargetThread) hold.reset(new SuspendedWindowThread(target));
            postChecked(target, WM_MOUSEMOVE, 0, lp, "mouse-move");
            postChecked(target, press, downFlag, lp, "mouse-button-down");
            postChecked(target, up, 0, lp, "mouse-button-up");
        }
        if (i + 1 < count) Sleep(80);
    }
}

static void sendDrag(HWND hwnd, POINT from, POINT to) {
    POINT start = {};
    HWND target = resolveMessageTarget(hwnd, from, &start);
    POINT end = to;
    ScreenToClient(target, &end);
    LPARAM startParam = toLParam(start.x, start.y);
    postChecked(target, WM_MOUSEMOVE, 0, startParam, "mouse-move");
    postChecked(target, WM_LBUTTONDOWN, MK_LBUTTON, startParam, "mouse-button-down");
    for (int i = 1; i <= 12; i++) {
        int x = (int)std::round(start.x + (end.x - start.x) * i / 12.0);
        int y = (int)std::round(start.y + (end.y - start.y) * i / 12.0);
        postChecked(target, WM_MOUSEMOVE, MK_LBUTTON, toLParam(x, y), "mouse-move");
        Sleep(20);
    }
    postChecked(target, WM_LBUTTONUP, 0, toLParam(end.x, end.y), "mouse-button-up");
}

static void sendScroll(HWND hwnd, POINT screen, const std::string& direction, double pages) {
    POINT client = {};
    HWND target = resolveMessageTarget(hwnd, screen, &client);
    int delta = (int)std::round(120 * pages);
    UINT message = WM_MOUSEWHEEL;
    if (direction == "down" || direction == "right") delta *= -1;
    if (direction == "left" || direction == "right") message = WM_MOUSEHWHEEL;
    // Wheel messages carry screen coordinates.
    postChecked(target, message, toWheelWParam(delta), toLParam(screen.x, screen.y), "mouse-wheel");
}

static bool sendTextToEditHandle(HWND hwnd, const std::wstring& text, IUIAutomationElement* element) {
    if (!hwnd) return false;
    auto sendWithTimeout = [hwnd](UINT message, WPARAM wParam, LPARAM lParam, DWORD_PTR* result) {
        SetLastError(0);
        if (SendMessageTimeoutW(hwnd, message, wParam, lParam, SMTO_ABORTIFHUNG | SMTO_NORMAL, 2000, result)) return;
        DWORD error = GetLastError();
        throw CodedError(
            error == ERROR_ACCESS_DENIED ? "uipi_blocked" : "target_not_responding",
            "The app did not accept typed text within 2 s (" + win32ErrorText(error) +
            "); it may be hung or busy. Nothing more was sent.");
    };
    DWORD_PTR result = 0;
    sendWithTimeout(EM_SETSEL, (WPARAM)-1, (LPARAM)-1, &result);
    if ((LONG_PTR)result >= 0) {
        sendWithTimeout(EM_REPLACESEL, TRUE, (LPARAM)text.c_str(), &result);
        return true;
    }
    std::wstring current = element ? getElementValue(element) : L"";
    std::wstring next = current + text;
    sendWithTimeout(WM_SETTEXT, 0, (LPARAM)next.c_str(), &result);
    return result != 0;
}

static int virtualKey(const std::string& key) {
    std::string k = key;
    std::transform(k.begin(), k.end(), k.begin(), ::tolower);
    static const std::map<std::string, int> keys = {
        {"return", VK_RETURN}, {"enter", VK_RETURN}, {"tab", VK_TAB}, {"escape", VK_ESCAPE}, {"esc", VK_ESCAPE},
        {"backspace", VK_BACK}, {"back_space", VK_BACK}, {"delete", VK_DELETE}, {"space", VK_SPACE},
        {"left", VK_LEFT}, {"up", VK_UP}, {"right", VK_RIGHT}, {"down", VK_DOWN},
        {"home", VK_HOME}, {"end", VK_END}, {"page_up", VK_PRIOR}, {"prior", VK_PRIOR},
        {"page_down", VK_NEXT}, {"next", VK_NEXT}
    };
    auto it = keys.find(k);
    if (it != keys.end()) return it->second;
    if (k.size() >= 2 && k[0] == 'f') {
        int n = atoi(k.c_str() + 1);
        if (n >= 1 && n <= 12) return VK_F1 + n - 1;
    }
    if (k.size() == 4 && k.substr(0, 3) == "kp_" && k[3] >= '0' && k[3] <= '9') return VK_NUMPAD0 + (k[3] - '0');
    if (k.size() == 1) {
        char c = (char)toupper(k[0]);
        if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z')) return c;
    }
    throw std::runtime_error("Unsupported key: " + key);
}

static std::vector<std::string> keyParts(const std::string& key) {
    std::vector<std::string> parts;
    std::string current;
    for (char c : key) {
        if (c == '+') {
            if (!current.empty()) parts.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty()) parts.push_back(current);
    return parts;
}

static std::vector<int> modifierKeys(const std::vector<std::string>& parts) {
    std::vector<int> modifiers;
    for (size_t i = 0; i + 1 < parts.size(); i++) {
        std::string m = parts[i];
        std::transform(m.begin(), m.end(), m.begin(), ::tolower);
        if (m == "ctrl" || m == "control") modifiers.push_back(VK_CONTROL);
        else if (m == "shift") modifiers.push_back(VK_SHIFT);
        else if (m == "alt") modifiers.push_back(VK_MENU);
        else if (m == "super" || m == "win" || m == "cmd") modifiers.push_back(VK_LWIN);
        else throw std::runtime_error("Unsupported modifier: " + parts[i]);
    }
    return modifiers;
}

static bool isExtendedVirtualKey(WORD vk) {
    switch (vk) {
    case VK_LEFT: case VK_RIGHT: case VK_UP: case VK_DOWN:
    case VK_HOME: case VK_END: case VK_PRIOR: case VK_NEXT:
    case VK_INSERT: case VK_DELETE: case VK_LWIN: case VK_RWIN:
    case VK_RCONTROL: case VK_RMENU: case VK_DIVIDE: case VK_NUMLOCK:
        return true;
    default:
        return false;
    }
}

static LPARAM keyMessageLParam(WORD vk, bool keyUp, bool altHeld) {
    UINT scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
    LPARAM lp = 1 | ((LPARAM)(scan & 0xff) << 16);
    if (isExtendedVirtualKey(vk)) lp |= (LPARAM)1 << 24;
    if (altHeld) lp |= (LPARAM)1 << 29;
    if (keyUp) lp |= ((LPARAM)1 << 30) | ((LPARAM)1 << 31);
    return lp;
}

// Posted keys reach the focused control without moving focus. Alt chords go
// as system keys, the way Windows delivers them, so menus open; posted
// messages cannot change the keyboard state apps read for Ctrl/Shift/Win, so
// those chords are refused before this is called.
static void sendKey(HWND hwnd, const std::string& key) {
    std::vector<std::string> parts = keyParts(key);
    if (parts.empty()) throw std::runtime_error("press_key requires a key.");
    std::vector<int> modifiers = modifierKeys(parts);
    WORD vk = (WORD)virtualKey(parts.back());
    bool alt = std::find(modifiers.begin(), modifiers.end(), VK_MENU) != modifiers.end();
    HWND target = keyboardMessageTarget(hwnd);
    UINT down = alt ? WM_SYSKEYDOWN : WM_KEYDOWN;
    UINT up = alt ? WM_SYSKEYUP : WM_KEYUP;
    for (int mod : modifiers) postChecked(target, down, mod, keyMessageLParam((WORD)mod, false, alt), "key-down");
    postChecked(target, down, vk, keyMessageLParam(vk, false, alt), "key-down");
    Sleep(25);
    postChecked(target, up, vk, keyMessageLParam(vk, true, alt), "key-up");
    std::reverse(modifiers.begin(), modifiers.end());
    for (int mod : modifiers) {
        bool altStillHeld = alt && mod != VK_MENU;
        postChecked(target, altStillHeld ? WM_SYSKEYUP : WM_KEYUP, mod, keyMessageLParam((WORD)mod, true, altStillHeld), "key-up");
    }
}

static void sendText(HWND hwnd, const std::wstring& text) {
    HWND target = keyboardMessageTarget(hwnd);
    for (wchar_t ch : text) {
        postChecked(target, WM_CHAR, (WPARAM)ch, 1, "character");
        Sleep(8);
    }
}

// ---- Foreground delivery, only when the caller asks for it: the window is
// brought to the front and gets real OS input at the pointer, then the
// user's window and pointer are put back. Every injection is checked:
// SendInput's count, the pointer's actual position, the foreground window
// and the window under the point. Nothing is reported as delivered unless
// Windows accepted it. Input that something on the machine filters (a game's
// anti-cheat, a secure desktop) is reported, never worked around.

static void ensureInputDesktop() {
    HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!desktop) {
        DWORD error = GetLastError();
        throw CodedError(
            "input_desktop_unavailable",
            "Real input can't be delivered right now: the interactive desktop is not available (" +
            win32ErrorText(error) + "). The screen is probably locked or asleep, or a UAC/secure prompt is showing.");
    }
    wchar_t name[64] = {};
    DWORD needed = 0;
    bool isDefault = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &needed) &&
        _wcsicmp(name, L"Default") == 0;
    CloseDesktop(desktop);
    if (!isDefault) {
        throw CodedError(
            "input_desktop_unavailable",
            "Real input can't be delivered right now: the secure desktop (" + toUtf8(name) +
            ") is active, e.g. a UAC prompt, the lock screen or Ctrl+Alt+Del. Ask the user to deal with it.");
    }
}

static std::string describeInputBlocker(DWORD error) {
    if (error == ERROR_ACCESS_DENIED) {
        return " Windows denied it: the input desktop changed (lock screen, UAC) or a higher-integrity window has focus.";
    }
    return " Something on this computer filters injected input for the window in front, commonly a game's "
        "anti-cheat. Stella can't deliver this input there; tell the user instead of retrying.";
}

static void sendInputChecked(std::vector<INPUT>& inputs, const std::string& what) {
    if (inputs.empty()) return;
    SetLastError(0);
    UINT sent = SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT));
    if (sent == (UINT)inputs.size()) return;
    DWORD error = GetLastError();
    std::ostringstream message;
    message << "Windows refused injected input: SendInput accepted " << sent << " of " << inputs.size() << " "
            << what << " event" << (inputs.size() == 1 ? "" : "s") << " (" << win32ErrorText(error) << ").";
    message << describeInputBlocker(error);
    throw CodedError(sent == 0 ? "input_refused" : "input_partially_injected", message.str());
}

// Virtual key plus// Virtual key plus its hardware scan code, like a physical keyboard: apps
// that read raw input or DirectInput (games) see the scan code, the rest the
// virtual key.
static INPUT keyInput(WORD vk, DWORD flags) {
    INPUT input = {};
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = vk;
    input.ki.wScan = (WORD)MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
    input.ki.dwFlags = flags | (isExtendedVirtualKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
    return input;
}

static INPUT mouseButtonInput(DWORD flags, DWORD data = 0) {
    INPUT input = {};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = flags;
    input.mi.mouseData = data;
    return input;
}

static INPUT absolutePointerInput(POINT screen) {
    int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int width = std::max(2, GetSystemMetrics(SM_CXVIRTUALSCREEN));
    int height = std::max(2, GetSystemMetrics(SM_CYVIRTUALSCREEN));
    INPUT input = {};
    input.type = INPUT_MOUSE;
    input.mi.dx = (LONG)std::lround((screen.x - left) * 65535.0 / (width - 1));
    input.mi.dy = (LONG)std::lround((screen.y - top) * 65535.0 / (height - 1));
    input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    return input;
}

static void movePointerChecked(POINT target) {
    std::vector<INPUT> move = {absolutePointerInput(target)};
    sendInputChecked(move, "pointer-move");
    POINT now = {};
    for (int attempt = 0; attempt < 10; attempt++) {
        if (GetCursorPos(&now) && std::abs(now.x - target.x) <= 2 && std::abs(now.y - target.y) <= 2) return;
        Sleep(5);
    }
    throw CodedError(
        "pointer_not_moved",
        "Windows accepted the pointer move to (" + std::to_string(target.x) + ", " + std::to_string(target.y) +
        ") but the pointer is at (" + std::to_string(now.x) + ", " + std::to_string(now.y) +
        "): something on this computer intercepted it (a game's anti-cheat or another input filter), "
        "so no button was pressed. Stella can't move the pointer in this window; tell the user instead of retrying.");
}

static bool waitForForeground(HWND hwnd, int timeoutMs) {
    unsigned long long deadline = GetTickCount64() + (unsigned long long)timeoutMs;
    while (true) {
        HWND foreground = GetForegroundWindow();
        if (foreground == hwnd || (foreground && GetAncestor(foreground, GA_ROOT) == hwnd)) return true;
        if (GetTickCount64() >= deadline) return false;
        Sleep(15);
    }
}

static std::string describeWindow(HWND window) {
    if (!window) return "no window";
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    std::string title = toUtf8(getWindowText(window));
    std::string text = toUtf8(processNameForPid(pid));
    if (!title.empty()) text += " \"" + title + "\"";
    return text;
}

static void ensureForegroundInputTarget(HWND hwnd) {
    if (!hwnd || !IsWindow(hwnd)) {
        throw CodedError("target_window_gone", "The target window no longer exists, so nothing was sent.");
    }
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
    if (waitForForeground(hwnd, 0)) return;
    SetForegroundWindow(hwnd);
    if (waitForForeground(hwnd, 150)) return;
    // The foreground lock lets a process take focus only when it is allowed
    // to (e.g. it produced the last input). Join the current foreground
    // thread's input state for the switch, then retry once after a neutral
    // zero-distance pointer event that gives this process the last input.
    HWND foreground = GetForegroundWindow();
    DWORD foregroundThread = foreground ? GetWindowThreadProcessId(foreground, NULL) : 0;
    DWORD selfThread = GetCurrentThreadId();
    bool attached = foregroundThread && foregroundThread != selfThread &&
        AttachThreadInput(selfThread, foregroundThread, TRUE);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (attached) AttachThreadInput(selfThread, foregroundThread, FALSE);
    if (waitForForeground(hwnd, 150)) return;
    INPUT nudge = {};
    nudge.type = INPUT_MOUSE;
    nudge.mi.dwFlags = MOUSEEVENTF_MOVE;
    SendInput(1, &nudge, sizeof(INPUT));
    SetForegroundWindow(hwnd);
    if (waitForForeground(hwnd, 300)) return;
    throw CodedError(
        "foreground_refused",
        "Windows refused to bring the target window to the front (foreground lock); " +
        describeWindow(GetForegroundWindow()) +
        " keeps focus, so real input would go there. Nothing was sent. A fullscreen app or a modal dialog "
        "elsewhere usually causes this; close it or ask the user to click the target window once.");
}

static void ensurePointReachesTarget(HWND hwnd, DWORD pid, POINT screen) {
    HWND hit = WindowFromPoint(screen);
    if (!hit) return;
    HWND root = GetAncestor(hit, GA_ROOT);
    if (root == hwnd || withinRoot(hwnd, hit)) return;
    DWORD hitPid = 0;
    GetWindowThreadProcessId(hit, &hitPid);
    if (hitPid == pid || hitPid == GetCurrentProcessId()) return;
    if (lowerW(processNameForPid(hitPid)) == lowerW(processNameForPid(pid))) return;
    throw CodedError(
        "point_covered",
        "The point (" + std::to_string(screen.x) + ", " + std::to_string(screen.y) + ") is covered by another window: " +
        describeWindow(root ? root : hit) + ". A real click would land there, so nothing was sent. "
        "Close or move that window, or choose a point the target shows.");
}

static void prepareForegroundInput(HWND hwnd, DWORD pid) {
    ensureInputDesktop();
    ensureInputAllowedByIntegrity(pid);
    ensureForegroundInputTarget(hwnd);
}

static bool writeUtf8File(const std::wstring& path, const std::string& text);

// ---- Background delivery: the user keeps their pointer, keyboard focus and
// the window in front. Each route is chosen per framework and kind of input;
// input a window would silently drop is refused with background_unavailable
// rather than sent, and nothing here ever brings the target forward.

static bool forceForegroundAttached(HWND window) {
    HWND current = GetForegroundWindow();
    if (current == window) return true;
    DWORD self = GetCurrentThreadId();
    DWORD currentThread = current ? GetWindowThreadProcessId(current, NULL) : 0;
    bool attached = currentThread && currentThread != self && AttachThreadInput(self, currentThread, TRUE);
    SetForegroundWindow(window);
    if (attached) AttachThreadInput(self, currentThread, FALSE);
    return GetForegroundWindow() == window;
}

// Gives `window` the foreground back after Stella's input moved it, retrying
// once this process owns the last input event (a key with no meaning to any
// app), which the foreground lock requires.
static bool restoreForegroundTo(HWND window) {
    if (!window || !IsWindow(window)) return false;
    if (forceForegroundAttached(window) || waitForForeground(window, 60)) return true;
    INPUT nudge[2] = {};
    nudge[0].type = INPUT_KEYBOARD;
    nudge[0].ki.wVk = 0xFC; // VK_NONAME
    nudge[1] = nudge[0];
    nudge[1].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(2, nudge, sizeof(INPUT));
    for (int attempt = 0; attempt < 3; attempt++) {
        if (forceForegroundAttached(window) || waitForForeground(window, 40)) return true;
        Sleep(25);
    }
    return waitForForeground(window, 100);
}

static bool onCurrentVirtualDesktop(HWND root) {
    IVirtualDesktopManager* manager = nullptr;
    if (FAILED(CoCreateInstance(CLSID_VirtualDesktopManager, NULL, CLSCTX_ALL, IID_PPV_ARGS(&manager))) || !manager) {
        return true;
    }
    BOOL on = TRUE;
    HRESULT hr = manager->IsWindowOnCurrentVirtualDesktop(root, &on);
    manager->Release();
    return FAILED(hr) || on;
}

// A window Stella disabled for a UI Automation call is written down until it
// is enabled again, so a helper that is killed mid-call can re-enable it the
// next time it starts.
static std::wstring disabledWindowRecordPath() {
    wchar_t temp[MAX_PATH] = {};
    DWORD length = GetTempPathW(MAX_PATH, temp);
    return std::wstring(temp, length) + L"stella-computer-helper-disabled-window.txt";
}

static void recordDisabledWindow(HWND hwnd, DWORD pid) {
    std::ostringstream out;
    out << hwndValue(hwnd) << " " << pid << " " << toUtf8(classNameForWindow(hwnd));
    writeUtf8File(disabledWindowRecordPath(), out.str());
}

static void clearDisabledWindowRecord() {
    DeleteFileW(disabledWindowRecordPath().c_str());
}

static void recoverDisabledWindow() {
    std::string text = readUtf8File(disabledWindowRecordPath());
    if (text.empty()) return;
    std::istringstream in(text);
    long long value = 0;
    DWORD pid = 0;
    std::string className;
    in >> value >> pid;
    std::getline(in, className);
    if (!className.empty() && className[0] == ' ') className.erase(0, 1);
    HWND hwnd = hwndFromValue(value);
    DWORD currentPid = 0;
    if (hwnd && IsWindow(hwnd)) GetWindowThreadProcessId(hwnd, &currentPid);
    if (hwnd && IsWindow(hwnd) && currentPid == pid && toUtf8(classNameForWindow(hwnd)) == className &&
        !IsWindowEnabled(hwnd)) {
        EnableWindow(hwnd, TRUE);
    }
    clearDisabledWindowRecord();
}

// Held around every background action on a window the user is not using.
// WS_EX_NOACTIVATE keeps the window from activating on the click it gets;
// around UI Automation calls on UWP/XAML and Chromium hosts, which call
// SetForegroundWindow on themselves from their handlers, the window is also
// disabled for the call (a disabled window can't take the foreground; the
// call still lands). Afterwards it watches briefly for the window taking
// the foreground anyway and gives it back to the window the user had in
// front, and puts the pointer back if injected pen input moved it.
class BackgroundGuard {
public:
    BackgroundGuard(HWND target, DWORD pid, bool disableForCall, int watchMs)
        : pid_(pid), watchMs_(watchMs) {
        root_ = GetAncestor(target, GA_ROOT);
        if (!root_) root_ = target;
        previousForeground_ = GetForegroundWindow();
        cursorKnown_ = !!GetCursorPos(&cursor_);
        DWORD foregroundPid = 0;
        if (previousForeground_) GetWindowThreadProcessId(previousForeground_, &foregroundPid);
        targetInFront_ = previousForeground_ &&
            (GetAncestor(previousForeground_, GA_ROOT) == root_ || foregroundPid == pid_);
        if (targetInFront_) return;
        LONG_PTR style = GetWindowLongPtrW(root_, GWL_EXSTYLE);
        if (!(style & WS_EX_NOACTIVATE) && onCurrentVirtualDesktop(root_)) {
            SetWindowLongPtrW(root_, GWL_EXSTYLE, style | WS_EX_NOACTIVATE);
            noActivate_ = (GetWindowLongPtrW(root_, GWL_EXSTYLE) & WS_EX_NOACTIVATE) != 0;
        }
        if (disableForCall && IsWindowEnabled(root_)) {
            recordDisabledWindow(root_, pid_);
            EnableWindow(root_, FALSE);
            disabled_ = true;
        }
    }

    ~BackgroundGuard() { finish(); }
    BackgroundGuard(const BackgroundGuard&) = delete;
    BackgroundGuard& operator=(const BackgroundGuard&) = delete;

    void injectedAt(POINT point) { injectedPoints_.push_back(point); }

    void finish() {
        if (finished_) return;
        finished_ = true;
        if (disabled_) {
            EnableWindow(root_, TRUE);
            clearDisabledWindowRecord();
        }
        unsigned long long deadline = GetTickCount64() + (unsigned long long)(targetInFront_ ? 0 : std::max(0, watchMs_));
        while (true) {
            restoreCursorIfStellaMovedIt();
            reclaimForegroundIfTargetTookIt();
            if (GetTickCount64() >= deadline) break;
            Sleep(15);
        }
        if (noActivate_) {
            LONG_PTR style = GetWindowLongPtrW(root_, GWL_EXSTYLE);
            SetWindowLongPtrW(root_, GWL_EXSTYLE, style & ~(LONG_PTR)WS_EX_NOACTIVATE);
        }
        reclaimForegroundIfTargetTookIt();
    }

private:
    bool belongsToTarget(HWND window) const {
        if (!window) return false;
        if (GetAncestor(window, GA_ROOT) == root_) return true;
        DWORD windowPid = 0;
        GetWindowThreadProcessId(window, &windowPid);
        return windowPid == pid_;
    }

    void reclaimForegroundIfTargetTookIt() {
        if (targetInFront_ || !previousForeground_ || !IsWindow(previousForeground_)) return;
        HWND now = GetForegroundWindow();
        if (now == previousForeground_ || !belongsToTarget(now)) return;
        restoreForegroundTo(previousForeground_);
    }

    void restoreCursorIfStellaMovedIt() {
        if (!cursorKnown_ || injectedPoints_.empty()) return;
        POINT now = {};
        if (!GetCursorPos(&now) || (now.x == cursor_.x && now.y == cursor_.y)) return;
        for (const POINT& point : injectedPoints_) {
            if (std::abs(now.x - point.x) <= 2 && std::abs(now.y - point.y) <= 2) {
                SetCursorPos(cursor_.x, cursor_.y);
                return;
            }
        }
    }

    HWND root_ = NULL;
    DWORD pid_ = 0;
    int watchMs_ = 0;
    HWND previousForeground_ = NULL;
    POINT cursor_ = {};
    bool cursorKnown_ = false;
    bool targetInFront_ = false;
    bool noActivate_ = false;
    bool disabled_ = false;
    bool finished_ = false;
    std::vector<POINT> injectedPoints_;
};

static bool selfActivatesFromUiaCalls(Framework framework) {
    return framework == Framework::XamlUwp || framework == Framework::WinUI3 ||
        framework == Framework::Chromium || framework == Framework::ChromiumEmbedded;
}

static const int kBackgroundWatchMs = 150;

// ---- Synthetic pen input. Windows routes it by screen position through the
// system input queue, so apps that ignore posted messages (Chromium, WPF,
// UWP, Tk, GTK) take it as real pointer input, without the target being in
// front and without the user's pointer. It lands on whatever is visible at
// the point, so a covered point is refused instead of clicking the cover.
// Technique after Cua's Windows driver (MIT, Cua AI, Inc.; packages/native/LICENSE-cua).

typedef HSYNTHETICPOINTERDEVICE(WINAPI* CreateSyntheticPointerDeviceFn)(POINTER_INPUT_TYPE, ULONG, POINTER_FEEDBACK_MODE);
typedef BOOL(WINAPI* InjectSyntheticPointerInputFn)(HSYNTHETICPOINTERDEVICE, const POINTER_TYPE_INFO*, UINT32);
typedef void(WINAPI* DestroySyntheticPointerDeviceFn)(HSYNTHETICPOINTERDEVICE);

struct SyntheticPointerApi {
    CreateSyntheticPointerDeviceFn create = nullptr;
    InjectSyntheticPointerInputFn inject = nullptr;
    DestroySyntheticPointerDeviceFn destroy = nullptr;
    bool available() const { return create && inject && destroy; }
};

static const SyntheticPointerApi& syntheticPointerApi() {
    static SyntheticPointerApi api = [] {
        SyntheticPointerApi loaded;
        HMODULE user32 = GetModuleHandleW(L"user32.dll");
        if (!user32) return loaded;
        loaded.create = reinterpret_cast<CreateSyntheticPointerDeviceFn>(
            reinterpret_cast<void*>(GetProcAddress(user32, "CreateSyntheticPointerDevice")));
        loaded.inject = reinterpret_cast<InjectSyntheticPointerInputFn>(
            reinterpret_cast<void*>(GetProcAddress(user32, "InjectSyntheticPointerInput")));
        loaded.destroy = reinterpret_cast<DestroySyntheticPointerDeviceFn>(
            reinterpret_cast<void*>(GetProcAddress(user32, "DestroySyntheticPointerDevice")));
        return loaded;
    }();
    return api;
}

class SyntheticPen {
public:
    SyntheticPen() {
        const SyntheticPointerApi& api = syntheticPointerApi();
        if (!api.available()) {
            throw CodedError(
                "background_unavailable",
                "This version of Windows has no synthetic pen input (it arrived in Windows 10 1809), which Stella needs "
                "to act on this window in the background.");
        }
        device_ = api.create(PT_PEN, 1, POINTER_FEEDBACK_DEFAULT);
        if (!device_) {
            throw CodedError(
                "background_unavailable",
                "Windows refused to create the synthetic pen Stella uses for background input (" +
                win32ErrorText(GetLastError()) + ").");
        }
    }
    ~SyntheticPen() {
        if (device_) syntheticPointerApi().destroy(device_);
    }
    SyntheticPen(const SyntheticPen&) = delete;
    SyntheticPen& operator=(const SyntheticPen&) = delete;

    bool inject(POINT point, POINTER_FLAGS flags, bool barrel) {
        POINTER_TYPE_INFO info = {};
        info.type = PT_PEN;
        info.penInfo.pointerInfo.pointerType = PT_PEN;
        info.penInfo.pointerInfo.pointerId = 0;
        info.penInfo.pointerInfo.pointerFlags = flags;
        info.penInfo.pointerInfo.ptPixelLocation = point;
        info.penInfo.penFlags = barrel ? PEN_FLAG_BARREL : PEN_FLAG_NONE;
        info.penInfo.pressure = 512;
        SetLastError(0);
        return syntheticPointerApi().inject(device_, &info, 1) != FALSE;
    }

    void injectChecked(POINT point, POINTER_FLAGS flags, bool barrel, const char* what, bool somethingSent) {
        if (inject(point, flags, barrel)) return;
        DWORD error = GetLastError();
        throw CodedError(
            somethingSent ? "input_partially_injected" : "background_unavailable",
            std::string("Windows refused the pen ") + what + " (" + win32ErrorText(error) + ")" +
            (somethingSent ? "; part of the gesture was already delivered." : "; nothing was delivered."));
    }

private:
    HSYNTHETICPOINTERDEVICE device_ = NULL;
};

static const POINTER_FLAGS kPenDown = POINTER_FLAG_DOWN | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT;
static const POINTER_FLAGS kPenMove = POINTER_FLAG_UPDATE | POINTER_FLAG_INRANGE | POINTER_FLAG_INCONTACT;
static const POINTER_FLAGS kPenUp = POINTER_FLAG_UP;

static void penTap(POINT point, bool barrel, int count) {
    SyntheticPen pen;
    for (int i = 0; i < std::max(1, count); i++) {
        pen.injectChecked(point, kPenDown, barrel, "press", i > 0);
        Sleep(25);
        if (!pen.inject(point, kPenUp, barrel)) {
            DWORD error = GetLastError();
            pen.inject(point, kPenUp, barrel);
            throw CodedError(
                "input_partially_injected",
                "Windows took the pen press but refused its release (" + win32ErrorText(error) + ").");
        }
        if (i + 1 < count) Sleep(70);
    }
}

static void penDrag(POINT from, POINT to, int steps) {
    SyntheticPen pen;
    pen.injectChecked(from, kPenDown, false, "press", false);
    for (int i = 1; i <= steps; i++) {
        Sleep(8);
        POINT step = {
            (LONG)std::lround(from.x + (to.x - from.x) * (double)i / steps),
            (LONG)std::lround(from.y + (to.y - from.y) * (double)i / steps),
        };
        if (!pen.inject(step, kPenMove, false)) {
            DWORD error = GetLastError();
            pen.inject(step, kPenUp, false);
            throw CodedError(
                "input_partially_injected",
                "Windows stopped taking the pen drag partway (" + win32ErrorText(error) + "); it was released where it stopped.");
        }
    }
    Sleep(8);
    pen.injectChecked(to, kPenUp, false, "release", true);
}

static bool pointOnAnyMonitor(POINT point) {
    return MonitorFromPoint(point, MONITOR_DEFAULTTONULL) != NULL;
}

// Pen input lands on whatever is visible at the point: the target, or one of
// the target app's own popups, never another app's window over it.
static void ensureVisibleForPen(HWND root, DWORD pid, POINT point, Framework framework, const std::string& what) {
    std::string where = "(" + std::to_string(point.x) + ", " + std::to_string(point.y) + ")";
    if (IsIconic(root)) {
        throw CodedError(
            "background_unavailable",
            frameworkLabel(framework) + " takes " + what + " in the background only where it shows on screen, and this "
            "window is minimized.");
    }
    if (!pointOnAnyMonitor(point)) {
        throw CodedError(
            "background_unavailable",
            "The point " + where + " is off every screen, so background " + what + " can't reach it.");
    }
    HWND hit = WindowFromPoint(point);
    HWND hitRoot = hit ? GetAncestor(hit, GA_ROOT) : NULL;
    DWORD hitPid = 0;
    if (hit) GetWindowThreadProcessId(hit, &hitPid);
    if (hitRoot == root || hitPid == pid) return;
    throw CodedError(
        "background_unavailable",
        frameworkLabel(framework) + " takes " + what + " in the background only where it shows on screen, and the point " +
        where + " is covered by " + describeWindow(hitRoot ? hitRoot : hit) + ".");
}

enum class BackgroundRoute { Post, Pen, Refuse };

struct BackgroundPlan {
    BackgroundRoute route = BackgroundRoute::Post;
    std::string why;
};

static BackgroundPlan postRoute() { return {BackgroundRoute::Post, ""}; }
static BackgroundPlan penRoute() { return {BackgroundRoute::Pen, ""}; }
static BackgroundPlan refusedRoute(const std::string& why) { return {BackgroundRoute::Refuse, why}; }

// kind: "click", "drag" or "scroll". `chromiumAtPoint` is true when the
// window under the point is Chromium's, e.g. a CEF/WebView2 view inside
// another app's window.
static BackgroundPlan pointerPlan(Framework framework, const std::string& kind, const std::string& button, int count,
                                  bool chromiumAtPoint) {
    if (framework == Framework::Chromium || chromiumAtPoint) {
        if (kind == "scroll") {
            return refusedRoute("ignores posted mouse-wheel input, and no element at that point scrolls through UI Automation");
        }
        if (kind == "drag") return penRoute();
        if (button == "middle") return refusedRoute("ignores posted middle clicks, and pen input has no middle button");
        // A single left click posted to the renderer's window is taken as a
        // click even while the window is covered; other clicks need the pen.
        if (button == "left" && count == 1) return postRoute();
        return penRoute();
    }
    switch (framework) {
    case Framework::Wpf:
        if (kind == "drag") return refusedRoute("handles a pen drag only while its window is in front, and ignores posted drags");
        if (kind == "scroll") {
            return refusedRoute("aims mouse-wheel input at the user's real pointer, and no element at that point scrolls through UI Automation");
        }
        if (button == "middle") return refusedRoute("ignores posted clicks, and pen input has no middle button");
        return penRoute();
    case Framework::XamlUwp:
        if (kind == "scroll") {
            return refusedRoute("ignores posted mouse-wheel input, and no element at that point scrolls through UI Automation");
        }
        if (kind == "drag") return penRoute();
        if (button == "middle") return refusedRoute("ignores posted clicks, and pen input has no middle button");
        return penRoute();
    case Framework::WinUI3:
        return refusedRoute(
            "ignores posted pointer input, and pen input would bring it to the front; only its UI Automation elements "
            "can be used in the background");
    case Framework::Tk:
    case Framework::DelphiVcl:
        if (kind == "scroll") return postRoute();
        if (button == "middle") return refusedRoute("ignores posted clicks, and pen input has no middle button");
        return penRoute();
    case Framework::Gtk:
        if (kind != "click") return postRoute();
        if (button == "middle") return refusedRoute("ignores posted clicks on buttons, and pen input has no middle button");
        return penRoute();
    default:
        return postRoute();
    }
}

static bool hasModifier(const std::string& key) {
    return keyParts(key).size() > 1;
}

static bool onlyAltModifier(const std::string& key) {
    std::vector<std::string> parts = keyParts(key);
    if (parts.size() < 2) return false;
    for (size_t i = 0; i + 1 < parts.size(); i++) {
        std::string m = parts[i];
        std::transform(m.begin(), m.end(), m.begin(), ::tolower);
        if (m != "alt") return false;
    }
    return true;
}

// kind: "key" (press_key) or "text" (posted characters, after the text
// field routes were tried).
static BackgroundPlan keyboardPlan(Framework framework, const std::string& kind, const std::string& key) {
    switch (framework) {
    case Framework::Wpf:
        return refusedRoute("ignores posted keyboard input while another window is in front");
    case Framework::Tk:
        return refusedRoute("reads keys from the real keyboard state, so posted keys are ignored");
    case Framework::XamlUwp:
    case Framework::WinUI3:
        return refusedRoute("ignores posted keyboard input");
    case Framework::LibreOffice:
        if (kind == "key") return refusedRoute("reads keys and shortcuts from the real keyboard state, so posted keys are ignored");
        return postRoute();
    case Framework::DelphiVcl:
        if (kind == "key" && hasModifier(key)) {
            return refusedRoute("reads shortcuts from the real keyboard state, so posted shortcuts are ignored");
        }
        return postRoute();
    case Framework::Chromium:
    case Framework::ChromiumEmbedded:
        if (kind == "key" && hasModifier(key)) {
            return refusedRoute("reads modifier keys from the real keyboard state, which posted keys don't change");
        }
        return postRoute();
    default:
        if (kind == "key" && hasModifier(key) && !onlyAltModifier(key)) {
            return refusedRoute(
                "reads Ctrl, Shift and Win from the real keyboard state, which posted keys don't change, so the shortcut "
                "would be ignored. Use the menu item or button for that command instead");
        }
        return postRoute();
    }
}

static CodedError backgroundUnavailable(Framework framework, const std::string& inputKind, const BackgroundPlan& plan) {
    return CodedError(
        "background_unavailable",
        "Background " + inputKind + " can't reach this window: it is " + frameworkLabel(framework) + ", which " +
        plan.why + ".");
}

// Foreground input borrows the screen for one action; the user's window and
// pointer are given back afterwards.
struct ForegroundRestore {
    HWND previous = NULL;
    HWND targetRoot = NULL;
    POINT cursor = {};
    bool cursorKnown = false;
    bool used = false;
    bool foregroundRestored = false;
    bool cursorRestored = false;
};

static void beginForegroundInput(ForegroundRestore& restore, HWND target) {
    restore = ForegroundRestore();
    restore.used = true;
    restore.previous = GetForegroundWindow();
    HWND root = GetAncestor(target, GA_ROOT);
    restore.targetRoot = root ? root : target;
    restore.cursorKnown = !!GetCursorPos(&restore.cursor);
}

static void endForegroundInput(ForegroundRestore& restore) {
    // Let the target take the input from its queue before focus leaves it.
    Sleep(60);
    if (restore.cursorKnown) {
        SetCursorPos(restore.cursor.x, restore.cursor.y);
        POINT now = {};
        restore.cursorRestored = GetCursorPos(&now) && std::abs(now.x - restore.cursor.x) <= 1 &&
            std::abs(now.y - restore.cursor.y) <= 1;
    }
    HWND previous = restore.previous;
    if (!previous || !IsWindow(previous) || GetAncestor(previous, GA_ROOT) == restore.targetRoot) {
        restore.foregroundRestored = true;
        return;
    }
    restore.foregroundRestored = restoreForegroundTo(previous);
}

template <typename Body>
static void withForegroundInput(HWND hwnd, ForegroundRestore& restore, Body body) {
    beginForegroundInput(restore, hwnd);
    try {
        body();
    } catch (...) {
        endForegroundInput(restore);
        throw;
    }
    endForegroundInput(restore);
}

static void releaseMouseButtonQuietly(DWORD upFlag) {
    INPUT up = mouseButtonInput(upFlag);
    SendInput(1, &up, sizeof(INPUT));
}

static void sendForegroundClick(HWND hwnd, DWORD pid, POINT screen, const std::string& button, int count) {
    prepareForegroundInput(hwnd, pid);
    ensurePointReachesTarget(hwnd, pid, screen);
    movePointerChecked(screen);
    DWORD down = MOUSEEVENTF_LEFTDOWN, up = MOUSEEVENTF_LEFTUP;
    if (button == "right") {
        down = MOUSEEVENTF_RIGHTDOWN;
        up = MOUSEEVENTF_RIGHTUP;
    } else if (button == "middle") {
        down = MOUSEEVENTF_MIDDLEDOWN;
        up = MOUSEEVENTF_MIDDLEUP;
    }
    for (int i = 0; i < std::max(1, count); i++) {
        std::vector<INPUT> press = {mouseButtonInput(down)};
        sendInputChecked(press, "mouse-button-down");
        Sleep(35);
        std::vector<INPUT> release = {mouseButtonInput(up)};
        sendInputChecked(release, "mouse-button-up");
        Sleep(50);
    }
}

static void sendForegroundDrag(HWND hwnd, DWORD pid, POINT from, POINT to) {
    prepareForegroundInput(hwnd, pid);
    ensurePointReachesTarget(hwnd, pid, from);
    movePointerChecked(from);
    std::vector<INPUT> press = {mouseButtonInput(MOUSEEVENTF_LEFTDOWN)};
    sendInputChecked(press, "mouse-button-down");
    try {
        for (int i = 1; i <= 16; i++) {
            POINT step = {
                (LONG)std::round(from.x + (to.x - from.x) * i / 16.0),
                (LONG)std::round(from.y + (to.y - from.y) * i / 16.0),
            };
            movePointerChecked(step);
            Sleep(20);
        }
    } catch (...) {
        releaseMouseButtonQuietly(MOUSEEVENTF_LEFTUP);
        throw;
    }
    std::vector<INPUT> release = {mouseButtonInput(MOUSEEVENTF_LEFTUP)};
    sendInputChecked(release, "mouse-button-up");
}

static void sendForegroundScroll(HWND hwnd, DWORD pid, POINT screen, const std::string& direction, double pages) {
    prepareForegroundInput(hwnd, pid);
    ensurePointReachesTarget(hwnd, pid, screen);
    movePointerChecked(screen);
    int delta = (int)std::round(120 * pages);
    DWORD flag = MOUSEEVENTF_WHEEL;
    if (direction == "down" || direction == "right") delta *= -1;
    if (direction == "left" || direction == "right") flag = MOUSEEVENTF_HWHEEL;
    std::vector<INPUT> wheel = {mouseButtonInput(flag, (DWORD)delta)};
    sendInputChecked(wheel, "mouse-wheel");
}

static void sendForegroundKey(HWND hwnd, DWORD pid, const std::string& key) {
    std::vector<std::string> parts = keyParts(key);
    if (parts.empty()) throw std::runtime_error("press_key requires a key.");
    std::vector<int> modifiers = modifierKeys(parts);
    WORD vk = (WORD)virtualKey(parts.back());
    prepareForegroundInput(hwnd, pid);
    std::vector<int> pressedModifiers;
    try {
        for (int mod : modifiers) {
            std::vector<INPUT> down = {keyInput((WORD)mod, 0)};
            sendInputChecked(down, "modifier-key-down");
            pressedModifiers.push_back(mod);
        }
        std::vector<INPUT> down = {keyInput(vk, 0)};
        sendInputChecked(down, "key-down");
        Sleep(25);
        std::vector<INPUT> up = {keyInput(vk, KEYEVENTF_KEYUP)};
        sendInputChecked(up, "key-up");
    } catch (...) {
        for (auto it = pressedModifiers.rbegin(); it != pressedModifiers.rend(); ++it) {
            INPUT release = keyInput((WORD)*it, KEYEVENTF_KEYUP);
            SendInput(1, &release, sizeof(INPUT));
        }
        throw;
    }
    for (auto it = pressedModifiers.rbegin(); it != pressedModifiers.rend(); ++it) {
        std::vector<INPUT> release = {keyInput((WORD)*it, KEYEVENTF_KEYUP)};
        sendInputChecked(release, "modifier-key-up");
    }
}

static void sendForegroundText(HWND hwnd, DWORD pid, const std::wstring& text) {
    prepareForegroundInput(hwnd, pid);
    size_t index = 0;
    try {
        for (; index < text.size(); index++) {
            wchar_t ch = text[index];
            std::vector<INPUT> inputs(2);
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].ki.wScan = ch;
            inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].ki.wScan = ch;
            inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            sendInputChecked(inputs, "text");
            Sleep(8);
        }
    } catch (const CodedError& error) {
        throw CodedError(
            index == 0 ? error.code : "input_partially_injected",
            "Typed " + std::to_string(index) + " of " + std::to_string(text.size()) +
            " characters before Windows stopped accepting input. " + error.what());
    }
}

static bool invokePreferredClick(IUIAutomationElement* element) {
    IUIAutomationInvokePattern* invoke = getPattern<IUIAutomationInvokePattern>(element, UIA_InvokePatternId);
    if (invoke) {
        HRESULT hr = invoke->Invoke();
        invoke->Release();
        if (SUCCEEDED(hr)) return true;
    }
    IUIAutomationSelectionItemPattern* select = getPattern<IUIAutomationSelectionItemPattern>(element, UIA_SelectionItemPatternId);
    if (select) {
        HRESULT hr = select->Select();
        select->Release();
        if (SUCCEEDED(hr)) return true;
    }
    IUIAutomationTogglePattern* toggle = getPattern<IUIAutomationTogglePattern>(element, UIA_TogglePatternId);
    if (toggle) {
        HRESULT hr = toggle->Toggle();
        toggle->Release();
        if (SUCCEEDED(hr)) return true;
    }
    IUIAutomationExpandCollapsePattern* expand = getPattern<IUIAutomationExpandCollapsePattern>(element, UIA_ExpandCollapsePatternId);
    if (expand) {
        ExpandCollapseState state = ExpandCollapseState_LeafNode;
        HRESULT hr = expand->get_CurrentExpandCollapseState(&state);
        bool attempted = false;
        if (SUCCEEDED(hr) && state == ExpandCollapseState_Collapsed) {
            hr = expand->Expand();
            attempted = true;
        } else if (SUCCEEDED(hr) && state == ExpandCollapseState_Expanded) {
            hr = expand->Collapse();
            attempted = true;
        }
        expand->Release();
        if (attempted && SUCCEEDED(hr)) return true;
    }
    return false;
}

static bool hasPreferredClickPattern(IUIAutomationElement* element) {
    IUIAutomationInvokePattern* invoke = getPattern<IUIAutomationInvokePattern>(element, UIA_InvokePatternId);
    if (invoke) {
        invoke->Release();
        return true;
    }
    IUIAutomationSelectionItemPattern* select = getPattern<IUIAutomationSelectionItemPattern>(element, UIA_SelectionItemPatternId);
    if (select) {
        select->Release();
        return true;
    }
    IUIAutomationTogglePattern* toggle = getPattern<IUIAutomationTogglePattern>(element, UIA_TogglePatternId);
    if (toggle) {
        toggle->Release();
        return true;
    }
    IUIAutomationExpandCollapsePattern* expand = getPattern<IUIAutomationExpandCollapsePattern>(element, UIA_ExpandCollapsePatternId);
    if (expand) {
        expand->Release();
        return true;
    }
    return false;
}

static bool elementContainsScreenPoint(IUIAutomationElement* element, DWORD pid, POINT screen, const Frame& windowFrame, double* areaOut) {
    if (!element) return false;
    int elementPid = 0;
    if (FAILED(element->get_CurrentProcessId(&elementPid)) || (DWORD)elementPid != pid) return false;
    RECT rect = {};
    if (FAILED(element->get_CurrentBoundingRectangle(&rect))) return false;
    if (rect.right <= rect.left || rect.bottom <= rect.top) return false;
    if (screen.x < rect.left || screen.x > rect.right || screen.y < rect.top || screen.y > rect.bottom) return false;
    if (windowFrame.present) {
        double windowRight = windowFrame.x + windowFrame.width;
        double windowBottom = windowFrame.y + windowFrame.height;
        if (rect.right < windowFrame.x || rect.left > windowRight || rect.bottom < windowFrame.y || rect.top > windowBottom) return false;
    }
    if (areaOut) *areaOut = (double)(rect.right - rect.left) * (double)(rect.bottom - rect.top);
    return true;
}

// The smallest clickable element (Invoke, Select, Toggle or Expand) at the
// point, or null. The caller releases it.
static IUIAutomationElement* clickableElementAtPoint(IUIAutomation* uia, IUIAutomationElement* root, DWORD pid, POINT screen, const Frame& windowFrame) {
    std::vector<IUIAutomationElement*> all;
    collectAllElements(uia, root, all);
    IUIAutomationElement* best = nullptr;
    double bestArea = 1.0e300;
    for (IUIAutomationElement* candidate : all) {
        double area = 0;
        if (!elementContainsScreenPoint(candidate, pid, screen, windowFrame, &area)) continue;
        if (!hasPreferredClickPattern(candidate)) continue;
        if (area < bestArea) {
            best = candidate;
            bestArea = area;
        }
    }
    for (IUIAutomationElement* candidate : all) {
        if (candidate != best) candidate->Release();
    }
    return best;
}

static void invokeSecondaryAction(IUIAutomationElement* element, const std::string& action, int index) {
    std::string lower = action;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    if (lower == "invoke") {
        IUIAutomationInvokePattern* pattern = getPattern<IUIAutomationInvokePattern>(element, UIA_InvokePatternId);
        if (pattern) { HRESULT hr = pattern->Invoke(); pattern->Release(); if (SUCCEEDED(hr)) return; }
    } else if (lower == "toggle") {
        IUIAutomationTogglePattern* pattern = getPattern<IUIAutomationTogglePattern>(element, UIA_TogglePatternId);
        if (pattern) { HRESULT hr = pattern->Toggle(); pattern->Release(); if (SUCCEEDED(hr)) return; }
    } else if (lower == "select") {
        IUIAutomationSelectionItemPattern* pattern = getPattern<IUIAutomationSelectionItemPattern>(element, UIA_SelectionItemPatternId);
        if (pattern) { HRESULT hr = pattern->Select(); pattern->Release(); if (SUCCEEDED(hr)) return; }
    } else if (lower == "expand" || lower == "collapse") {
        IUIAutomationExpandCollapsePattern* pattern = getPattern<IUIAutomationExpandCollapsePattern>(element, UIA_ExpandCollapsePatternId);
        if (pattern) {
            HRESULT hr = lower == "expand" ? pattern->Expand() : pattern->Collapse();
            pattern->Release();
            if (SUCCEEDED(hr)) return;
        }
    } else if (lower == "scrollintoview") {
        IUIAutomationScrollItemPattern* pattern = getPattern<IUIAutomationScrollItemPattern>(element, UIA_ScrollItemPatternId);
        if (pattern) { HRESULT hr = pattern->ScrollIntoView(); pattern->Release(); if (SUCCEEDED(hr)) return; }
    } else if (lower == "setfocus") {
        if (!envFlag("STELLA_COMPUTER_WINDOWS_ALLOW_FOCUS_ACTIONS")) {
            throw std::runtime_error("SetFocus is disabled by default to avoid stealing user focus; set STELLA_COMPUTER_WINDOWS_ALLOW_FOCUS_ACTIONS=1 to enable it.");
        }
        HRESULT hr = element->SetFocus();
        if (SUCCEEDED(hr)) return;
    }
    throw std::runtime_error(action + " is not a valid secondary action for " + std::to_string(index));
}

static void selectExactText(
    IUIAutomationElement* element,
    const std::wstring& exactText,
    const std::wstring& prefix,
    const std::wstring& suffix,
    const std::string& selectionMode) {
    if (!element) throw std::runtime_error("select-text target element is unavailable");
    IUIAutomationTextPattern* pattern = getPattern<IUIAutomationTextPattern>(element, UIA_TextPatternId);
    if (!pattern) {
        throw std::runtime_error("select-text requires a UIA TextPattern-capable element");
    }
    IUIAutomationTextRange* document = nullptr;
    BSTR documentText = nullptr;
    HRESULT hr = pattern->get_DocumentRange(&document);
    if (SUCCEEDED(hr) && document) hr = document->GetText(-1, &documentText);
    if (FAILED(hr) || !document || !documentText) {
        if (documentText) SysFreeString(documentText);
        safeRelease(document);
        safeRelease(pattern);
        throw std::runtime_error("select-text could not read the UIA text document");
    }
    std::wstring fullText(documentText, SysStringLen(documentText));
    SysFreeString(documentText);

    std::vector<size_t> matches;
    size_t searchFrom = 0;
    while (searchFrom <= fullText.size()) {
        size_t found = fullText.find(exactText, searchFrom);
        if (found == std::wstring::npos) break;
        bool prefixMatches = prefix.empty() ||
            (found >= prefix.size() && fullText.compare(found - prefix.size(), prefix.size(), prefix) == 0);
        size_t after = found + exactText.size();
        bool suffixMatches = suffix.empty() ||
            (after + suffix.size() <= fullText.size() && fullText.compare(after, suffix.size(), suffix) == 0);
        if (prefixMatches && suffixMatches) matches.push_back(found);
        searchFrom = found + std::max<size_t>(1, exactText.size());
    }
    if (matches.empty()) {
        safeRelease(document);
        safeRelease(pattern);
        throw std::runtime_error("select-text could not find the exact text with the requested context");
    }
    if (matches.size() > 1) {
        safeRelease(document);
        safeRelease(pattern);
        throw std::runtime_error("select-text matched more than once; provide --prefix or --suffix to disambiguate");
    }

    size_t matchStart = matches.front();
    size_t matchEnd = matchStart + exactText.size();
    size_t targetStart = selectionMode == "cursor-after" ? matchEnd : matchStart;
    size_t targetEnd = selectionMode == "cursor-before" ? matchStart : matchEnd;
    if (selectionMode != "text" && selectionMode != "cursor-before" && selectionMode != "cursor-after") {
        safeRelease(document);
        safeRelease(pattern);
        throw std::runtime_error("select-text selection must be text, cursor-before, or cursor-after");
    }

    IUIAutomationTextRange* range = nullptr;
    hr = document->Clone(&range);
    if (SUCCEEDED(hr) && range) {
        hr = range->MoveEndpointByRange(
            TextPatternRangeEndpoint_End,
            document,
            TextPatternRangeEndpoint_Start);
    }
    int moved = 0;
    if (SUCCEEDED(hr)) {
        hr = range->MoveEndpointByUnit(
            TextPatternRangeEndpoint_End,
            TextUnit_Character,
            (int)targetEnd,
            &moved);
    }
    if (SUCCEEDED(hr)) {
        hr = range->MoveEndpointByUnit(
            TextPatternRangeEndpoint_Start,
            TextUnit_Character,
            (int)targetStart,
            &moved);
    }
    if (SUCCEEDED(hr)) hr = range->Select();
    safeRelease(range);
    safeRelease(document);
    safeRelease(pattern);
    if (FAILED(hr)) throw std::runtime_error("select-text could not set the requested UIA text range");
}

static bool invokeScroll(IUIAutomationElement* element, const std::string& direction, double pages) {
    IUIAutomationScrollPattern* scroll = getPattern<IUIAutomationScrollPattern>(element, UIA_ScrollPatternId);
    if (!scroll) return false;
    ScrollAmount horizontal = ScrollAmount_NoAmount;
    ScrollAmount vertical = ScrollAmount_NoAmount;
    if (direction == "up") vertical = ScrollAmount_LargeDecrement;
    else if (direction == "down") vertical = ScrollAmount_LargeIncrement;
    else if (direction == "left") horizontal = ScrollAmount_LargeDecrement;
    else if (direction == "right") horizontal = ScrollAmount_LargeIncrement;
    int repeat = std::max(1, (int)std::ceil(pages));
    bool ok = true;
    for (int i = 0; i < repeat; i++) {
        ok = SUCCEEDED(scroll->Scroll(horizontal, vertical)) && ok;
        Sleep(40);
    }
    scroll->Release();
    return ok;
}

// Window classes that take EM_REPLACESEL/WM_SETTEXT: Win32 edit and rich
// edit controls and the controls built on them (WinForms, Delphi, Scintilla).
static bool isEditWindowClass(HWND hwnd) {
    std::wstring cls = lowerW(classNameForWindow(hwnd));
    if (cls.rfind(L"chrome_", 0) == 0) return false;
    return cls.find(L"edit") != std::wstring::npos || cls == L"scintilla" || cls == L"tmemo";
}

static bool isTextCandidate(HWND rootHwnd, IUIAutomationElement* element) {
    if (!element) return false;
    UIA_HWND native = NULL;
    if (FAILED(element->get_CurrentNativeWindowHandle(&native)) || native == 0 || (HWND)(intptr_t)native == rootHwnd) return false;
    if (!isEditWindowClass((HWND)(intptr_t)native)) return false;
    std::wstring control = controlTypeName([&] { CONTROLTYPEID c = 0; element->get_CurrentControlType(&c); return c; }());
    std::wstring cls = getBstrProperty(&IUIAutomationElement::get_CurrentClassName, element);
    std::wstring hay = lowerW(control + L" " + cls);
    return hay.find(L"edit") != std::wstring::npos || hay.find(L"document") != std::wstring::npos ||
           hay.find(L"rich") != std::wstring::npos || hay.find(L"text") != std::wstring::npos;
}

static IUIAutomationElement* findTextEntryElement(IUIAutomation* uia, IUIAutomationElement* root, DWORD pid) {
    IUIAutomationElement* focused = nullptr;
    if (SUCCEEDED(uia->GetFocusedElement(&focused)) && focused) {
        int focusedPid = 0;
        if (SUCCEEDED(focused->get_CurrentProcessId(&focusedPid)) && (DWORD)focusedPid == pid) {
            IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(focused, UIA_ValuePatternId);
            BOOL readOnly = TRUE;
            if (value && SUCCEEDED(value->get_CurrentIsReadOnly(&readOnly)) && !readOnly) {
                value->Release();
                return focused;
            }
            safeRelease(value);
        }
    }
    safeRelease(focused);

    std::vector<IUIAutomationElement*> all;
    collectAllElements(uia, root, all);
    IUIAutomationElement* candidate = nullptr;
    for (IUIAutomationElement* element : all) {
        IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
        BOOL readOnly = TRUE;
        bool writable = value && SUCCEEDED(value->get_CurrentIsReadOnly(&readOnly)) && !readOnly;
        safeRelease(value);
        CONTROLTYPEID ctid = 0;
        element->get_CurrentControlType(&ctid);
        if (writable && (ctid == UIA_EditControlTypeId || ctid == UIA_DocumentControlTypeId)) {
            candidate = element;
            break;
        }
    }
    if (!candidate) {
        for (IUIAutomationElement* element : all) {
            IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
            BOOL readOnly = TRUE;
            bool writable = value && SUCCEEDED(value->get_CurrentIsReadOnly(&readOnly)) && !readOnly;
            safeRelease(value);
            if (writable) {
                candidate = element;
                break;
            }
        }
    }
    for (IUIAutomationElement* element : all) if (element != candidate) element->Release();
    return candidate;
}

static HWND findTextEntryWindowHandle(IUIAutomation* uia, IUIAutomationElement* root, HWND rootHwnd, IUIAutomationElement* preferred) {
    if (isTextCandidate(rootHwnd, preferred)) {
        UIA_HWND native = NULL;
        preferred->get_CurrentNativeWindowHandle(&native);
        return (HWND)(intptr_t)native;
    }
    std::vector<IUIAutomationElement*> all;
    collectAllElements(uia, root, all);
    HWND hwnd = NULL;
    for (IUIAutomationElement* element : all) {
        if (!isTextCandidate(rootHwnd, element)) continue;
        UIA_HWND native = NULL;
        element->get_CurrentNativeWindowHandle(&native);
        hwnd = (HWND)(intptr_t)native;
        break;
    }
    for (IUIAutomationElement* element : all) element->Release();
    return hwnd;
}

// The element's current center on screen. An element scrolled out of the
// window is scrolled back in through UI Automation first; a position outside
// the window would land on whatever is there.
static POINT liveElementCenter(IUIAutomationElement* element, const Frame& windowFrame) {
    auto read = [&](POINT* out) {
        RECT rect = {};
        if (FAILED(element->get_CurrentBoundingRectangle(&rect)) || rect.right <= rect.left || rect.bottom <= rect.top) {
            return false;
        }
        out->x = (rect.left + rect.right) / 2;
        out->y = (rect.top + rect.bottom) / 2;
        return true;
    };
    auto inside = [&](POINT p) {
        return !windowFrame.present ||
            (p.x >= windowFrame.x && p.x < windowFrame.x + windowFrame.width &&
             p.y >= windowFrame.y && p.y < windowFrame.y + windowFrame.height);
    };
    POINT center = {};
    if (!read(&center)) throw std::runtime_error("The element has no position on screen; observe again and pick a visible element.");
    if (inside(center)) return center;
    IUIAutomationScrollItemPattern* scrollItem = getPattern<IUIAutomationScrollItemPattern>(element, UIA_ScrollItemPatternId);
    if (scrollItem) {
        scrollItem->ScrollIntoView();
        scrollItem->Release();
        Sleep(120);
        if (read(&center) && inside(center)) return center;
    }
    throw std::runtime_error(
        "The element is outside the visible part of the window; scroll it into view (scroll with an element_index) "
        "and observe again.");
}

// Scrolls the innermost UI Automation container under the point that can
// scroll in that direction.
static bool scrollViaUiaAtPoint(IUIAutomation* uia, DWORD pid, POINT point, const std::string& direction, double pages) {
    IUIAutomationElement* current = nullptr;
    if (FAILED(uia->ElementFromPoint(point, &current)) || !current) return false;
    IUIAutomationTreeWalker* walker = nullptr;
    if (FAILED(uia->get_ControlViewWalker(&walker)) || !walker) {
        current->Release();
        return false;
    }
    bool vertical = direction == "up" || direction == "down";
    bool handled = false;
    for (int depth = 0; current && depth < 32; depth++) {
        int elementPid = 0;
        if (FAILED(current->get_CurrentProcessId(&elementPid)) || (DWORD)elementPid != pid) break;
        IUIAutomationScrollPattern* scroll = getPattern<IUIAutomationScrollPattern>(current, UIA_ScrollPatternId);
        if (scroll) {
            BOOL can = FALSE;
            HRESULT hr = vertical ? scroll->get_CurrentVerticallyScrollable(&can) : scroll->get_CurrentHorizontallyScrollable(&can);
            scroll->Release();
            if (SUCCEEDED(hr) && can) {
                handled = invokeScroll(current, direction, pages);
                break;
            }
        }
        IUIAutomationElement* parent = nullptr;
        walker->GetParentElement(current, &parent);
        current->Release();
        current = parent;
    }
    safeRelease(current);
    walker->Release();
    return handled;
}

// Puts text into the app's text field without keystrokes: an edit control
// through its own messages, a UI Automation value field through ValuePattern
// (appended to what is there). Returns the route, or "" when the window has
// neither.
static std::string typeTextIntoField(
    IUIAutomation* uia, IUIAutomationElement* root, const WindowProcess& process, Framework framework, const std::wstring& text) {
    IUIAutomationElement* element = findTextEntryElement(uia, root, process.pid);
    HWND editWindow = focusedDescendant(process.hwnd);
    if (!editWindow || !isEditWindowClass(editWindow)) editWindow = findTextEntryWindowHandle(uia, root, process.hwnd, element);
    if (editWindow && sendTextToEditHandle(editWindow, text, element)) {
        safeRelease(element);
        return "hwnd.edit.text";
    }
    // Web text fields in Chromium accept a UI Automation value without the
    // page seeing an input event, so they get typed characters instead.
    bool valueTextAllowed = framework == Framework::XamlUwp || framework == Framework::WinUI3 ||
        framework == Framework::Wpf || envFlag("STELLA_COMPUTER_WINDOWS_ALLOW_UIA_TEXT_FALLBACK");
    if (element && valueTextAllowed) {
        IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
        BOOL readOnly = TRUE;
        if (value && SUCCEEDED(value->get_CurrentIsReadOnly(&readOnly)) && !readOnly) {
            std::wstring combined = getElementValue(element) + text;
            BSTR next = SysAllocString(combined.c_str());
            HRESULT hr = E_FAIL;
            {
                BackgroundGuard guard(process.hwnd, process.pid, selfActivatesFromUiaCalls(framework), kBackgroundWatchMs);
                hr = value->SetValue(next);
                guard.finish();
            }
            SysFreeString(next);
            value->Release();
            safeRelease(element);
            if (FAILED(hr)) {
                std::ostringstream message;
                message << "The text field refused the text through UI Automation (HRESULT 0x" << std::hex << (unsigned long)hr
                        << "); nothing was typed.";
                throw std::runtime_error(message.str());
            }
            return "uia.value.text";
        }
        safeRelease(value);
    }
    safeRelease(element);
    return "";
}

struct ActionProbe {
    bool cursorKnown = false;
    POINT cursor = {};
    long long foreground = 0;
};

static ActionProbe captureProbe() {
    ActionProbe probe;
    probe.cursorKnown = !!GetCursorPos(&probe.cursor);
    probe.foreground = (long long)GetForegroundWindow();
    return probe;
}

static std::string receiptJson(
    const ActionProbe& before,
    const std::string& route,
    const std::string& dispatch,
    const AdaptiveSettle* settle,
    bool deferred,
    unsigned long long baselineRevision,
    unsigned long long finalRevision,
    int pendingActionCount,
    const std::string& delivery = "",
    const std::string& deliveryReason = "",
    const ForegroundRestore* restore = nullptr) {
    POINT after = {};
    bool afterKnown = !!GetCursorPos(&after);
    bool cursorMoved = !before.cursorKnown || !afterKnown || before.cursor.x != after.x || before.cursor.y != after.y;
    bool foregroundChanged = before.foreground != (long long)GetForegroundWindow();
    std::ostringstream out;
    out << "{\"ok\":true,\"route\":" << jsonString(route)
        << ",\"dispatch\":" << jsonString(dispatch)
        << ",\"lane\":\"same_session\",\"background_safe\":" << ((!cursorMoved && !foregroundChanged) ? "true" : "false")
        << ",\"cursor_moved\":" << (cursorMoved ? "true" : "false")
        << ",\"foreground_changed\":" << (foregroundChanged ? "true" : "false")
        << ",\"session\":\"parent\""
        << ",\"deferred\":" << (deferred ? "true" : "false")
        << ",\"baselineRevision\":" << baselineRevision
        << ",\"finalRevision\":" << finalRevision
        << ",\"pendingActionCount\":" << pendingActionCount;
    if (!delivery.empty()) out << ",\"delivery\":" << jsonString(delivery);
    if (!deliveryReason.empty()) out << ",\"delivery_reason\":" << jsonString(deliveryReason);
    if (restore && restore->used) {
        out << ",\"restored\":{\"foreground\":" << (restore->foregroundRestored ? "true" : "false")
            << ",\"cursor\":" << (restore->cursorRestored ? "true" : "false") << "}";
    }
    if (settle) {
        out << ",\"settle\":{\"observed\":" << (settle->observed ? "true" : "false")
            << ",\"quietMs\":" << adaptiveQuietMs
            << ",\"waitedMs\":" << settle->waitedMs
            << ",\"eventCount\":" << settle->eventCount
            << ",\"timedOut\":" << (settle->timedOut ? "true" : "false")
            << ",\"reason\":" << jsonString(settle->timedOut ? "uia-event-timeout" : "uia-event-quiet")
            << ",\"baselineRevision\":" << settle->baselineRevision
            << ",\"finalRevision\":" << settle->finalRevision
            << ",\"pendingActionCount\":" << settle->pendingActionCount << "}";
    }
    out << "}";
    return out.str();
}

static std::string elementJson(const ElementRecord& record) {
    std::ostringstream out;
    out << "{\"index\":" << record.index << ",\"runtimeId\":[";
    for (size_t i = 0; i < record.runtimeId.size(); i++) {
        if (i) out << ",";
        out << record.runtimeId[i];
    }
    out << "],\"automationId\":" << jsonString(toUtf8(record.automationId))
        << ",\"name\":" << jsonString(toUtf8(record.name))
        << ",\"controlType\":" << jsonString(toUtf8(record.controlType))
        << ",\"localizedControlType\":" << jsonString(toUtf8(record.localizedControlType))
        << ",\"className\":" << jsonString(toUtf8(record.className))
        << ",\"value\":" << jsonString(toUtf8(record.value))
        << ",\"nativeWindowHandle\":" << record.nativeWindowHandle
        << ",\"frame\":" << frameJson(record.frame)
        << ",\"actions\":[";
    for (size_t i = 0; i < record.actions.size(); i++) {
        if (i) out << ",";
        out << jsonString(record.actions[i]);
    }
    out << "]}";
    return out.str();
}

static std::string snapshotJson(const Snapshot& snapshot) {
    std::ostringstream out;
    out << "{\"app\":{\"name\":" << jsonString(toUtf8(snapshot.appName))
        << ",\"bundleIdentifier\":" << jsonString(toUtf8(snapshot.appName))
        << ",\"pid\":" << snapshot.pid << "},\"windowId\":" << snapshot.windowId
        << ",\"windowTitle\":" << jsonString(toUtf8(snapshot.windowTitle))
        << ",\"windowBounds\":" << frameJson(snapshot.windowBounds)
        << ",\"screenshotPngBase64\":";
    if (snapshot.screenshotBase64.empty()) out << "null";
    else out << jsonString(snapshot.screenshotBase64);
    out << ",\"treeLines\":[";
    for (size_t i = 0; i < snapshot.treeLines.size(); i++) {
        if (i) out << ",";
        out << jsonString(snapshot.treeLines[i]);
    }
    out << "],\"focusedSummary\":";
    if (snapshot.focusedSummary.empty()) out << "null";
    else out << jsonString(toUtf8(snapshot.focusedSummary));
    out << ",\"selectedText\":";
    if (snapshot.selectedText.empty()) out << "null";
    else out << jsonString(toUtf8(snapshot.selectedText));
    out << ",\"appInstructions\":";
    if (snapshot.appInstructions.empty()) out << "null";
    else out << jsonString(snapshot.appInstructions);
    out << ",\"revision\":" << snapshot.revision
        << ",\"materializedRevision\":" << snapshot.materializedRevision
        << ",\"cacheHit\":" << (snapshot.cacheHit ? "true" : "false")
        << ",\"cacheKey\":" << jsonString(snapshot.cacheKey)
        << ",\"pendingActionCount\":" << snapshot.pendingActionCount
        << ",\"screenshotPolicy\":" << jsonString(snapshot.screenshotPolicy)
        << ",\"screenshot\":";
    if (snapshot.screenshotWidth <= 0 || snapshot.screenshotHeight <= 0) {
        out << "null";
    } else {
        out << "{\"widthPx\":" << snapshot.screenshotWidth
            << ",\"heightPx\":" << snapshot.screenshotHeight << "}";
    }
    out << ",\"reliability\":{\"uiaEventsObserved\":" << (snapshot.uiaEventsObserved ? "true" : "false")
        << ",\"elementCacheValidated\":" << (snapshot.elementCacheValidated ? "true" : "false")
        << ",\"perMonitorDpiAware\":" << (processPerMonitorDpiAware ? "true" : "false")
        << ",\"screenshotLongEdgeCapPx\":" << screenshotLongEdgeCapPx
        << ",\"settleWaitedMs\":" << snapshot.settleWaitedMs
        << ",\"settleEventCount\":" << snapshot.settleEventCount
        << ",\"settleTimedOut\":" << (snapshot.settleTimedOut ? "true" : "false")
        << ",\"settleBaselineRevision\":" << snapshot.settleBaselineRevision
        << ",\"settleFinalRevision\":" << snapshot.settleFinalRevision << "}";
    out << ",\"warnings\":[";
    for (size_t i = 0; i < snapshot.warnings.size(); i++) {
        if (i) out << ",";
        out << jsonString(snapshot.warnings[i]);
    }
    out << "],\"capture\":{\"method\":";
    if (snapshot.captureMethod.empty()) out << "null";
    else out << jsonString(snapshot.captureMethod);
    out << ",\"occluded\":" << (snapshot.captureOccluded ? "true" : "false");
    out << ",\"blank\":" << (snapshot.captureBlank ? "true" : "false");
    if ((snapshot.captureOccluded || snapshot.captureBlank) && !snapshot.warnings.empty()) {
        out << ",\"warning\":" << jsonString(snapshot.warnings.back());
    }
    out << "}";
    if (!snapshot.surfaceKind.empty()) {
        out << ",\"surface\":{\"kind\":" << jsonString(snapshot.surfaceKind)
            << ",\"framework\":" << jsonString(snapshot.framework)
            << ",\"contentElements\":" << snapshot.contentElementCount
            << ",\"accessibilityWake\":" << jsonString(snapshot.accessibilityWake)
            << ",\"fullscreen\":" << (snapshot.surfaceFullscreen ? "true" : "false")
            << ",\"minimized\":" << (snapshot.surfaceMinimized ? "true" : "false") << "}";
    }
    out << ",\"elements\":[";
    for (size_t i = 0; i < snapshot.elements.size(); i++) {
        if (i) out << ",";
        out << elementJson(snapshot.elements[i]);
    }
    out << "]}";
    return out.str();
}

static std::string listAppsText(IUIAutomation* uia) {
    std::vector<WindowProcess> windows = listWindowProcesses(uia);
    std::sort(windows.begin(), windows.end(), [](const WindowProcess& a, const WindowProcess& b) {
        if (lowerW(a.processName) == lowerW(b.processName)) return a.pid < b.pid;
        return lowerW(a.processName) < lowerW(b.processName);
    });
    std::ostringstream out;
    for (size_t i = 0; i < windows.size(); i++) {
        if (i) out << "\n";
        std::string title = toUtf8(windows[i].title.empty() ? L"untitled" : windows[i].title);
        std::string name = toUtf8(windows[i].processName);
        out << name << " -- " << name << " [running, pid=" << windows[i].pid
            << ", target=hwnd:" << hwndValue(windows[i].hwnd) << ", window=" << title << "]";
    }
    return out.str();
}

static std::wstring classNameForWindow(HWND hwnd) {
    wchar_t buffer[256] = {};
    int length = GetClassNameW(hwnd, buffer, (int)(sizeof(buffer) / sizeof(buffer[0])));
    return length > 0 ? std::wstring(buffer, buffer + length) : L"";
}

static std::string windowRecordJson(const WindowProcess& window) {
    RECT rect = {};
    Frame bounds;
    if (GetWindowRect(window.hwnd, &rect)) bounds = frameFromRect(rect);
    std::ostringstream out;
    out << "{\"pid\":" << window.pid
        << ",\"windowId\":" << hwndValue(window.hwnd)
        << ",\"app\":" << jsonString(toUtf8(window.processName))
        << ",\"title\":" << jsonString(toUtf8(window.title))
        << ",\"bounds\":" << frameJson(bounds)
        << ",\"foreground\":" << (GetForegroundWindow() == window.hwnd ? "true" : "false")
        << ",\"className\":" << jsonString(toUtf8(classNameForWindow(window.hwnd)))
        << "}";
    return out.str();
}

static std::string listWindowsText(IUIAutomation* uia) {
    std::vector<WindowProcess> windows = listWindowProcesses(uia);
    std::sort(windows.begin(), windows.end(), [](const WindowProcess& a, const WindowProcess& b) {
        if (lowerW(a.processName) == lowerW(b.processName)) return hwndValue(a.hwnd) < hwndValue(b.hwnd);
        return lowerW(a.processName) < lowerW(b.processName);
    });
    std::ostringstream out;
    for (size_t i = 0; i < windows.size(); i++) {
        if (i) out << "\n";
        RECT rect = {};
        Frame bounds;
        if (GetWindowRect(windows[i].hwnd, &rect)) bounds = frameFromRect(rect);
        std::string title = toUtf8(windows[i].title.empty() ? L"untitled" : windows[i].title);
        std::string name = toUtf8(windows[i].processName);
        out << name << " -- " << title << " [pid=" << windows[i].pid
            << ", window-id=" << hwndValue(windows[i].hwnd)
            << ", target=hwnd:" << hwndValue(windows[i].hwnd);
        if (bounds.present) {
            out << ", bounds=" << (int)std::round(bounds.x) << "," << (int)std::round(bounds.y)
                << " " << (int)std::round(bounds.width) << "x" << (int)std::round(bounds.height);
        }
        out << ", class=" << toUtf8(classNameForWindow(windows[i].hwnd)) << "]";
    }
    return out.str();
}

static std::string listWindowsJson(IUIAutomation* uia) {
    std::vector<WindowProcess> windows = listWindowProcesses(uia);
    std::sort(windows.begin(), windows.end(), [](const WindowProcess& a, const WindowProcess& b) {
        if (lowerW(a.processName) == lowerW(b.processName)) return hwndValue(a.hwnd) < hwndValue(b.hwnd);
        return lowerW(a.processName) < lowerW(b.processName);
    });
    std::ostringstream out;
    out << "{\"ok\":true,\"text\":" << jsonString(listWindowsText(uia)) << ",\"windows\":[";
    for (size_t i = 0; i < windows.size(); i++) {
        if (i) out << ",";
        out << windowRecordJson(windows[i]);
    }
    out << "]}";
    return out.str();
}

static std::string doctorText(IUIAutomation* uia) {
    DWORD sessionId = 0;
    bool hasSession = !!ProcessIdToSessionId(GetCurrentProcessId(), &sessionId);
    HDESK inputDesktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    bool hasInputDesktop = inputDesktop != NULL;
    if (inputDesktop) CloseDesktop(inputDesktop);
    std::vector<WindowProcess> windows = listWindowProcesses(uia);
    DWORD foregroundPid = 0;
    HWND foreground = GetForegroundWindow();
    if (foreground) GetWindowThreadProcessId(foreground, &foregroundPid);

    std::ostringstream out;
    out << "Windows runtime: stella-computer-helper.exe\n";
    out << "UI Automation: available\n";
    out << "Process session: " << (hasSession ? std::to_string(sessionId) : "unknown");
    if (hasSession && sessionId == 0) out << " (not an interactive user desktop)";
    out << "\n";
    out << "Interactive desktop: " << (hasInputDesktop ? "available" : "not available") << "\n";
    out << "Process integrity: " << integrityName(integrityRidForProcess(GetCurrentProcessId())) << "\n";
    out << "Visible top-level windows: " << windows.size() << "\n";
    if (foreground) {
        out << "Foreground window: target=hwnd:" << hwndValue(foreground) << " pid=" << foregroundPid << "\n";
    }
    out << "Synthetic pen input (background clicks in Chromium, WPF, UWP, Tk and GTK windows): "
        << (syntheticPointerApi().available() ? "available" : "not available (needs Windows 10 1809 or later)") << "\n";
    out << "Background input: Win32 messages can be blocked by higher-integrity target apps; Stella reports that instead of pretending the click worked.";
    return out.str();
}

static long long operationWindowId(const Json& operation) {
    const Json* value = operation.get("windowId");
    return value && value->type == Json::Number ? (long long)value->numberValue : 0;
}

static std::string failJson(const std::string& error, const std::string& code = "") {
    if (code.empty()) return "{\"ok\":false,\"error\":" + jsonString(error) + "}";
    return "{\"ok\":false,\"code\":" + jsonString(code) + ",\"error\":" + jsonString(error) + "}";
}

static std::string okSnapshotJson(const Snapshot& snapshot) {
    return "{\"ok\":true,\"snapshot\":" + snapshotJson(snapshot) + "}";
}

static std::string executeOperation(IUIAutomation* uia, const Json& operation);

static std::string executeBatchOperation(IUIAutomation* uia, const Json& operation) {
    const Json* commands = operation.get("commands");
    if (!commands || commands->type != Json::Array) {
        throw std::runtime_error("batch commands must be an array");
    }
    if (commands->arrayValue.empty() || commands->arrayValue.size() > 64) {
        throw std::runtime_error("batch commands must contain between 1 and 64 operations");
    }

    std::ostringstream results;
    size_t completed = 0;
    std::string failure;
    for (size_t index = 0; index < commands->arrayValue.size(); index++) {
        const Json& command = commands->arrayValue[index];
        if (command.type != Json::Object) {
            failure = "batch command " + std::to_string(index) + " must be an object";
        } else if (command.str("tool") == "batch") {
            failure = "nested batch operations are not supported";
        }

        std::string result;
        if (failure.empty()) {
            try {
                result = executeOperation(uia, command);
                JsonParser parser(result);
                Json parsed = parser.parseValue();
                const Json* ok = parsed.get("ok");
                if (!ok || ok->type != Json::Bool || !ok->boolValue) {
                    const Json* error = parsed.get("error");
                    failure = error && error->type == Json::String
                        ? error->stringValue
                        : "batch command " + std::to_string(index) + " failed";
                }
            } catch (const std::exception& error) {
                failure = error.what();
            }
        }

        if (index) results << ",";
        results << "{\"index\":" << index;
        if (failure.empty()) {
            results << ",\"ok\":true,\"result\":" << result << "}";
            completed += 1;
            continue;
        }
        results << ",\"ok\":false,\"error\":" << jsonString(failure) << "}";
        break;
    }
    std::ostringstream out;
    out << "{\"ok\":" << (failure.empty() ? "true" : "false")
        << ",\"completed\":" << completed
        << ",\"results\":[" << results.str() << "]";
    if (!failure.empty()) out << ",\"error\":" << jsonString(failure);
    out << "}";
    return out.str();
}

struct DaemonOptions {
    std::wstring pipeName;
    std::wstring pidFile;
};

static bool writeUtf8File(const std::wstring& path, const std::string& text) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    BOOL ok = WriteFile(file, text.data(), (DWORD)text.size(), &written, NULL);
    CloseHandle(file);
    return ok && written == text.size();
}

static DaemonOptions parseDaemonOptions(int argc, char** argv) {
    DaemonOptions options;
    for (int i = 2; i + 1 < argc; i++) {
        std::string key = argv[i] ? argv[i] : "";
        std::wstring value = toWide(argv[i + 1] ? argv[i + 1] : "");
        if (key == "--pipe-name") {
            options.pipeName = value;
            i++;
        } else if (key == "--pid-file") {
            options.pidFile = value;
            i++;
        }
    }
    if (options.pipeName.empty() || options.pidFile.empty()) {
        throw std::runtime_error("stella-computer-helper daemon requires --pipe-name and --pid-file.");
    }
    return options;
}

static std::string daemonEnvelope(long long seq, int status, const std::string& stdoutText, const std::string& stderrText) {
    std::ostringstream out;
    out << "{\"seq\":" << seq
        << ",\"status\":" << status
        << ",\"stdout\":" << jsonString(stdoutText)
        << ",\"stderr\":" << jsonString(stderrText)
        << "}";
    return out.str();
}

static std::string readPipeRequest(HANDLE pipe) {
    std::string request;
    char buffer[4096];
    while (true) {
        DWORD read = 0;
        BOOL ok = ReadFile(pipe, buffer, sizeof(buffer), &read, NULL);
        if (!ok || read == 0) break;
        request.append(buffer, buffer + read);
        if (request.find('\n') != std::string::npos) break;
    }
    size_t newline = request.find('\n');
    if (newline != std::string::npos) request.resize(newline);
    return request;
}

static void writePipeResponse(HANDLE pipe, const std::string& response) {
    std::string text = response + "\n";
    DWORD written = 0;
    WriteFile(pipe, text.data(), (DWORD)text.size(), &written, NULL);
    FlushFileBuffers(pipe);
}

static std::string executeDaemonPayload(IUIAutomation* uia, const std::string& payload) {
    if (payload.empty()) return "";
    try {
        JsonParser parser(payload);
        Json request = parser.parseValue();
        long long seq = (long long)request.num("seq", 0);
        const Json* operation = request.get("operation");
        if (!operation || operation->type != Json::Object) {
            return daemonEnvelope(seq, 1, "", "invalid daemon request");
        }
        try {
            return daemonEnvelope(seq, 0, executeOperation(uia, *operation), "");
        } catch (const CodedError& error) {
            return daemonEnvelope(seq, 0, failJson(error.what(), error.code), "");
        } catch (const std::exception& error) {
            return daemonEnvelope(seq, 0, failJson(error.what()), "");
        }
    } catch (const std::exception& error) {
        return daemonEnvelope(0, 1, "", error.what());
    }
}

static int runDaemon(IUIAutomation* uia, const DaemonOptions& options) {
    writeUtf8File(options.pidFile, std::to_string(GetCurrentProcessId()));
    while (true) {
        HANDLE pipe = CreateNamedPipeW(
            options.pipeName.c_str(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            1024 * 1024,
            1024 * 1024,
            0,
            NULL
        );
        if (pipe == INVALID_HANDLE_VALUE) {
            Sleep(200);
            continue;
        }
        BOOL connected = ConnectNamedPipe(pipe, NULL) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);
        if (connected) {
            std::string request = readPipeRequest(pipe);
            std::string response = executeDaemonPayload(uia, request);
            if (!response.empty()) writePipeResponse(pipe, response);
        }
        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }
}

static int operationElementIndex(const Json& operation) {
    const Json* element = operation.get("element");
    return element ? (int)element->num("index", -1) : -1;
}

static bool operationBool(const Json& operation, const std::string& key, bool fallback = false) {
    const Json* value = operation.get(key);
    return value && value->type == Json::Bool ? value->boolValue : fallback;
}

static std::string operationScreenshotPolicy(const Json& operation) {
    std::string policy = operation.str("screenshot_policy", "always");
    if (policy != "auto" && policy != "always" && policy != "never") {
        throw std::runtime_error("screenshot_policy must be auto, always, or never");
    }
    return policy;
}

static bool isAtomicActionTool(const std::string& tool) {
    return tool == "click" || tool == "perform_secondary_action" ||
        tool == "scroll" || tool == "drag" || tool == "type_text" ||
        tool == "press_key" || tool == "set_value" || tool == "select_text";
}

static std::string staleObservationJson(
    const Json& precondition,
    unsigned long long currentRevision,
    const std::string& reason) {
    std::ostringstream out;
    out << "{\"ok\":false,\"code\":\"stale_observation\",\"error\":"
        << jsonString(reason)
        << ",\"observed_state_id\":" << jsonString(precondition.str("state_id"))
        << ",\"current_revision\":" << currentRevision << "}";
    return out.str();
}

// Returns an empty string when the target still matches the observation. The
// daemon handles one request at a time, so a successful check is adjacent to
// dispatch and cannot be interleaved by another Stella session.
static std::string validateAtomicPrecondition(
    IUIAutomation* uia,
    const Json& command,
    const Json& precondition) {
    const Json* expectedPidValue = precondition.get("target_pid");
    const Json* expectedRevisionValue = precondition.get("revision");
    const Json* expectedMaterializedValue = precondition.get("materialized_revision");
    if (precondition.str("state_id").empty() ||
        !expectedPidValue || expectedPidValue->type != Json::Number ||
        !expectedRevisionValue || expectedRevisionValue->type != Json::Number ||
        !expectedMaterializedValue || expectedMaterializedValue->type != Json::Number) {
        throw std::runtime_error(
            "atomic action precondition requires state_id, target_pid, revision, and materialized_revision");
    }

    std::wstring app = toWide(command.str("app"));
    long long windowId = operationWindowId(command);
    WindowProcess process = resolveApp(uia, app, windowId);
    TargetState& targetState = targetStateFor(uia, process);
    unsigned long long currentRevision = targetState.tracker
        ? targetState.tracker->revision.load()
        : 0;
    unsigned long long expectedPid = (unsigned long long)expectedPidValue->numberValue;
    unsigned long long expectedRevision =
        (unsigned long long)expectedRevisionValue->numberValue;
    unsigned long long expectedMaterialized =
        (unsigned long long)expectedMaterializedValue->numberValue;
    if ((unsigned long long)process.pid != expectedPid) {
        return staleObservationJson(
            precondition,
            currentRevision,
            "Observed Windows target process changed before dispatch.");
    }
    const Json* expectedWindowValue = precondition.get("window_id");
    if (expectedWindowValue) {
        if (expectedWindowValue->type != Json::Number) {
            throw std::runtime_error("atomic action window_id precondition must be a number");
        }
        if ((unsigned long long)hwndValue(process.hwnd) !=
            (unsigned long long)expectedWindowValue->numberValue) {
            return staleObservationJson(
                precondition,
                currentRevision,
                "Observed Windows target window changed before dispatch.");
        }
    }
    // Screenshot-coordinate actions are checked against pixels by the runtime
    // and tolerate a window whose accessibility tree never stops changing;
    // for them only the process and window identity must still match.
    bool windowScope = precondition.str("scope") == "window";
    if (!windowScope && (currentRevision != expectedRevision ||
        targetState.materializedRevision != expectedMaterialized)) {
        return staleObservationJson(
            precondition,
            currentRevision,
            "Observed Windows app state changed before dispatch.");
    }
    return "";
}

static std::string executeAtomicActionOperation(IUIAutomation* uia, const Json& operation) {
    const Json* command = operation.get("command");
    const Json* precondition = operation.get("precondition");
    if (!command || command->type != Json::Object ||
        !precondition || precondition->type != Json::Object) {
        throw std::runtime_error("atomic_action requires command and precondition objects");
    }
    if (!isAtomicActionTool(command->str("tool"))) {
        throw std::runtime_error("atomic_action requires one supported mutating command");
    }
    std::string stale = validateAtomicPrecondition(uia, *command, *precondition);
    if (!stale.empty()) return stale;
    return executeOperation(uia, *command);
}

static std::string executeAtomicBatchOperation(IUIAutomation* uia, const Json& operation) {
    const Json* commands = operation.get("commands");
    if (!commands || commands->type != Json::Array) {
        throw std::runtime_error("atomic_batch commands must be an array");
    }
    if (commands->arrayValue.empty() || commands->arrayValue.size() > 64) {
        throw std::runtime_error("atomic_batch commands must contain between 1 and 64 operations");
    }

    // Validate every member before dispatching any member. This prevents a
    // stale command later in a batch from causing a partial mutation.
    for (size_t index = 0; index < commands->arrayValue.size(); index++) {
        const Json& item = commands->arrayValue[index];
        const Json* command = item.get("command");
        const Json* precondition = item.get("precondition");
        if (item.type != Json::Object || !command || command->type != Json::Object ||
            !precondition || precondition->type != Json::Object) {
            throw std::runtime_error(
                "atomic_batch command " + std::to_string(index) +
                " requires command and precondition objects");
        }
        if (!isAtomicActionTool(command->str("tool"))) {
            throw std::runtime_error(
                "atomic_batch command " + std::to_string(index) +
                " is not a supported mutating command");
        }
        std::string stale = validateAtomicPrecondition(uia, *command, *precondition);
        if (!stale.empty()) return stale;
    }

    std::ostringstream results;
    size_t completed = 0;
    std::string failure;
    std::string failureCode;
    for (size_t index = 0; index < commands->arrayValue.size(); index++) {
        const Json& command = *commands->arrayValue[index].get("command");
        std::string result;
        try {
            result = executeOperation(uia, command);
            JsonParser parser(result);
            Json parsed = parser.parseValue();
            const Json* ok = parsed.get("ok");
            if (!ok || ok->type != Json::Bool || !ok->boolValue) {
                const Json* error = parsed.get("error");
                failure = error && error->type == Json::String
                    ? error->stringValue
                    : "atomic_batch command " + std::to_string(index) + " failed";
                failureCode = parsed.str("code");
            }
        } catch (const CodedError& error) {
            failure = error.what();
            failureCode = error.code;
        } catch (const std::exception& error) {
            failure = error.what();
        }

        if (index) results << ",";
        results << "{\"index\":" << index;
        if (failure.empty()) {
            results << ",\"ok\":true,\"result\":" << result << "}";
            completed += 1;
            continue;
        }
        results << ",\"ok\":false,\"error\":" << jsonString(failure);
        if (!failureCode.empty()) results << ",\"code\":" << jsonString(failureCode);
        results << "}";
        break;
    }
    std::ostringstream out;
    out << "{\"ok\":" << (failure.empty() ? "true" : "false")
        << ",\"completed\":" << completed
        << ",\"results\":[" << results.str() << "]";
    if (!failure.empty()) out << ",\"error\":" << jsonString(failure);
    if (!failureCode.empty()) out << ",\"code\":" << jsonString(failureCode);
    out << "}";
    return out.str();
}

static std::string executeOperation(IUIAutomation* uia, const Json& operation) {
    std::string tool = operation.str("tool");
    if (tool == "atomic_action") {
        return executeAtomicActionOperation(uia, operation);
    }
    if (tool == "atomic_batch") {
        return executeAtomicBatchOperation(uia, operation);
    }
    if (tool == "batch") {
        return executeBatchOperation(uia, operation);
    }
    if (tool == "list_apps") {
        return "{\"ok\":true,\"text\":" + jsonString(listAppsText(uia)) + "}";
    }
    if (tool == "list_windows") {
        return listWindowsJson(uia);
    }
    if (tool == "doctor") {
        return "{\"ok\":true,\"text\":" + jsonString(doctorText(uia)) + "}";
    }
    std::wstring app = toWide(operation.str("app"));
    long long windowId = operationWindowId(operation);
    if (tool == "get_app_state") {
        return okSnapshotJson(buildSnapshot(uia, app, windowId, operationScreenshotPolicy(operation)));
    }
    if (tool == "launch_app") {
        const Json* startMinimizedValue = operation.get("start_minimized");
        bool startMinimized = startMinimizedValue && startMinimizedValue->type == Json::Bool && startMinimizedValue->boolValue;
        WindowProcess launched = launchApp(uia, app, startMinimized);
        Snapshot snapshot = buildSnapshot(uia, app, hwndValue(launched.hwnd), "always");
        std::ostringstream out;
        out << "{\"ok\":true,\"text\":"
            << jsonString("Launched " + toUtf8(launched.processName) + " target=hwnd:" + std::to_string(hwndValue(launched.hwnd)))
            << ",\"windows\":[" << windowRecordJson(launched) << "]"
            << ",\"snapshot\":" << snapshotJson(snapshot) << "}";
        return out.str();
    }

    WindowProcess process = resolveApp(uia, app, windowId);
    TargetState& targetState = targetStateFor(uia, process);
    IUIAutomationElement* root = targetState.root;
    root->AddRef();
    IUIAutomationElement* element = nullptr;
    try {
    const Json* elementJsonValue = operation.get("element");
    element = findValidatedCachedElement(targetState, elementJsonValue);
    if (!element) element = findElement(uia, root, elementJsonValue);
    Frame windowFrame = parseFrame(&operation);
    const Json* wb = operation.get("windowBounds");
    if (wb && wb->type == Json::Object) {
        windowFrame.present = true;
        windowFrame.x = wb->num("x");
        windowFrame.y = wb->num("y");
        windowFrame.width = wb->num("width");
        windowFrame.height = wb->num("height");
    } else {
        windowFrame = windowBounds(process.hwnd, root);
    }
    ActionProbe probe = captureProbe();
    unsigned long long baselineRevision = targetState.tracker ? targetState.tracker->revision.load() : 0;
    unsigned long long baselineEventCount = targetState.tracker ? targetState.tracker->eventCount.load() : 0;
    std::string route = "unknown";
    std::string delivery = "uia";
    std::string deliveryReason;
    std::string dispatch = operation.str("dispatch", "background");
    if (dispatch == "auto") dispatch = "background";
    if (dispatch != "background" && dispatch != "foreground") {
        throw std::runtime_error("unsupported dispatch mode: " + dispatch);
    }

    // The software cursor is deliberately driven from the same native action
    // boundary as the real input. Background PostMessage/CG-style delivery
    // does not move the user's physical cursor, so the visual cursor must
    // arrive before the click or drag is injected. A failed/disabled overlay
    // never changes the action's dispatch semantics.
    if (!envFlag("STELLA_COMPUTER_NO_OVERLAY") && gAgentCursorOverlay &&
        (tool == "click" || tool == "drag")) {
        POINT visualPoint = {};
        bool haveVisualPoint = false;
        if (tool == "click") {
            Frame elementFrame = parseFrame(elementJsonValue);
            if (elementFrame.present && windowFrame.present) {
                visualPoint = screenPointFromFrame(elementFrame, windowFrame);
                haveVisualPoint = true;
            } else if (windowFrame.present && operation.get("x") && operation.get("y")) {
                double screenshotWidth = operation.num("screenshot_width", windowFrame.width);
                double screenshotHeight = operation.num("screenshot_height", windowFrame.height);
                double scaleX = screenshotWidth > 0 ? windowFrame.width / screenshotWidth : 1.0;
                double scaleY = screenshotHeight > 0 ? windowFrame.height / screenshotHeight : 1.0;
                visualPoint.x = (LONG)std::lround(windowFrame.x + operation.num("x") * scaleX);
                visualPoint.y = (LONG)std::lround(windowFrame.y + operation.num("y") * scaleY);
                haveVisualPoint = true;
            }
        } else if (windowFrame.present && operation.get("from_x") && operation.get("from_y")) {
            double screenshotWidth = operation.num("screenshot_width", windowFrame.width);
            double screenshotHeight = operation.num("screenshot_height", windowFrame.height);
            double scaleX = screenshotWidth > 0 ? windowFrame.width / screenshotWidth : 1.0;
            double scaleY = screenshotHeight > 0 ? windowFrame.height / screenshotHeight : 1.0;
            visualPoint.x = (LONG)std::lround(windowFrame.x + operation.num("from_x") * scaleX);
            visualPoint.y = (LONG)std::lround(windowFrame.y + operation.num("from_y") * scaleY);
            haveVisualPoint = true;
        }
        if (haveVisualPoint) {
            gAgentCursorOverlay->moveToAndWait(visualPoint, process.hwnd);
        }
    }

    if (!targetState.surfaceKnown) refreshSurfaceIdentity(targetState);
    const Framework framework = targetState.framework;
    const bool background = dispatch == "background";
    ForegroundRestore foregroundRestore;
    auto screenshotPoint = [&](const char* xKey, const char* yKey) {
        double screenshotWidth = operation.num("screenshot_width", windowFrame.width);
        double screenshotHeight = operation.num("screenshot_height", windowFrame.height);
        double scaleX = screenshotWidth > 0 ? windowFrame.width / screenshotWidth : 1.0;
        double scaleY = screenshotHeight > 0 ? windowFrame.height / screenshotHeight : 1.0;
        return POINT{
            (LONG)std::round(windowFrame.x + operation.num(xKey) * scaleX),
            (LONG)std::round(windowFrame.y + operation.num(yKey) * scaleY),
        };
    };
    auto chromiumAt = [&](POINT point) {
        return framework == Framework::Chromium ||
            isChromiumClassName(classNameForWindow(deepestChildFromPoint(process.hwnd, point)));
    };
    // An edit control inside a XAML/WinUI window (Notepad's text area) is an
    // ordinary Win32 window that takes posted input.
    auto pointerFramework = [&](POINT point) {
        HWND deepest = deepestChildFromPoint(process.hwnd, point);
        return deepest != process.hwnd && isEditWindowClass(deepest) ? Framework::Win32 : framework;
    };
    auto keyboardFramework = [&]() {
        HWND focused = focusedDescendant(process.hwnd);
        return focused && isEditWindowClass(focused) ? Framework::Win32 : framework;
    };
    auto effectiveFramework = [&](bool chromiumAtPoint) {
        return chromiumAtPoint && framework != Framework::Chromium ? Framework::ChromiumEmbedded : framework;
    };
    auto runUia = [&](auto call) {
        BackgroundGuard guard(process.hwnd, process.pid, selfActivatesFromUiaCalls(framework), kBackgroundWatchMs);
        auto result = call();
        guard.finish();
        return result;
    };

    if (tool == "click") {
        std::string button = operation.str("mouse_button", "left");
        int clickCount = std::max(1, (int)operation.num("click_count", 1));
        Frame elementFrame = parseFrame(elementJsonValue);
        POINT point = elementFrame.present && windowFrame.present ? screenPointFromFrame(elementFrame, windowFrame)
                                                                  : screenshotPoint("x", "y");
        if (!background) {
            withForegroundInput(process.hwnd, foregroundRestore, [&] {
                sendForegroundClick(process.hwnd, process.pid, point, button, clickCount);
            });
            delivery = "foreground";
            deliveryReason = "requested";
            route = "foreground.sendinput.click";
        } else {
            bool chromiumAtPoint = chromiumAt(point);
            // Chromium answers UI Automation Invoke with success without
            // clicking when the window is covered, and raises it when it
            // does; clicks there go by position instead.
            bool uiaClick = !chromiumAtPoint && button == "left" && clickCount == 1;
            bool handled = false;
            if (uiaClick && element) {
                handled = runUia([&] { return invokePreferredClick(element); });
                if (handled) route = "uia.pattern.click";
            }
            if (uiaClick && !handled) {
                IUIAutomationElement* hit = clickableElementAtPoint(uia, root, process.pid, point, windowFrame);
                if (hit) {
                    try {
                        handled = runUia([&] { return invokePreferredClick(hit); });
                    } catch (...) {
                        hit->Release();
                        throw;
                    }
                    hit->Release();
                }
                if (handled) route = "uia.hit_test.click";
            }
            if (handled) {
                delivery = "uia";
            } else {
                if (element) point = liveElementCenter(element, windowFrame);
                Framework base = chromiumAtPoint ? framework : pointerFramework(point);
                Framework effective = chromiumAtPoint ? effectiveFramework(true) : base;
                BackgroundPlan plan = pointerPlan(base, "click", button, clickCount, chromiumAtPoint);
                if (plan.route == BackgroundRoute::Refuse) throw backgroundUnavailable(effective, "clicks", plan);
                ensureCanPostMessages(process.pid);
                deliveryReason = frameworkId(effective);
                if (plan.route == BackgroundRoute::Pen) {
                    ensureVisibleForPen(process.hwnd, process.pid, point, effective, "clicks");
                    ensureInputDesktop();
                    BackgroundGuard guard(process.hwnd, process.pid, false, kBackgroundWatchMs);
                    guard.injectedAt(point);
                    penTap(point, button == "right", clickCount);
                    guard.finish();
                    route = "pointer.pen.click";
                } else {
                    BackgroundGuard guard(process.hwnd, process.pid, false, kBackgroundWatchMs);
                    sendMouseClick(process.hwnd, point, button, clickCount, chromiumAtPoint);
                    guard.finish();
                    route = "hwnd.postmessage.click";
                }
                delivery = "background";
            }
        }
    } else if (tool == "perform_secondary_action") {
        if (!element) throw std::runtime_error("unknown element_index '" + std::to_string(operationElementIndex(operation)) + "'");
        std::string action = operation.str("action");
        runUia([&] {
            invokeSecondaryAction(element, action, operationElementIndex(operation));
            return true;
        });
        route = "uia.secondary_action." + action;
        delivery = "uia";
    } else if (tool == "scroll") {
        std::string direction = operation.str("direction", "down");
        double pages = operation.num("pages", 1);
        Frame elementFrame = parseFrame(elementJsonValue);
        POINT point = elementFrame.present ? screenPointFromFrame(elementFrame, windowFrame)
                                           : POINT{(LONG)std::round(windowFrame.x + windowFrame.width / 2), (LONG)std::round(windowFrame.y + windowFrame.height / 2)};
        if (!background) {
            withForegroundInput(process.hwnd, foregroundRestore, [&] {
                sendForegroundScroll(process.hwnd, process.pid, point, direction, pages);
            });
            delivery = "foreground";
            deliveryReason = "requested";
            route = "foreground.sendinput.scroll";
        } else {
            bool handled = element && runUia([&] { return invokeScroll(element, direction, pages); });
            if (handled) route = "uia.scroll";
            if (!handled) {
                handled = runUia([&] { return scrollViaUiaAtPoint(uia, process.pid, point, direction, pages); });
                if (handled) route = "uia.scroll.at_point";
            }
            if (handled) {
                delivery = "uia";
            } else {
                bool chromiumAtPoint = chromiumAt(point);
                Framework base = chromiumAtPoint ? framework : pointerFramework(point);
                Framework effective = chromiumAtPoint ? effectiveFramework(true) : base;
                BackgroundPlan plan = pointerPlan(base, "scroll", "left", 1, chromiumAtPoint);
                if (plan.route != BackgroundRoute::Post) throw backgroundUnavailable(effective, "scrolling", plan);
                ensureCanPostMessages(process.pid);
                sendScroll(process.hwnd, point, direction, pages);
                delivery = "background";
                deliveryReason = frameworkId(effective);
                route = "hwnd.postmessage.scroll";
            }
        }
    } else if (tool == "drag") {
        POINT from = screenshotPoint("from_x", "from_y");
        POINT to = screenshotPoint("to_x", "to_y");
        if (!background) {
            withForegroundInput(process.hwnd, foregroundRestore, [&] {
                sendForegroundDrag(process.hwnd, process.pid, from, to);
            });
            delivery = "foreground";
            deliveryReason = "requested";
            route = "foreground.sendinput.drag";
        } else {
            bool chromiumAtPoint = chromiumAt(from);
            Framework base = chromiumAtPoint ? framework : pointerFramework(from);
            Framework effective = chromiumAtPoint ? effectiveFramework(true) : base;
            BackgroundPlan plan = pointerPlan(base, "drag", "left", 1, chromiumAtPoint);
            if (plan.route == BackgroundRoute::Refuse) throw backgroundUnavailable(effective, "drags", plan);
            ensureCanPostMessages(process.pid);
            deliveryReason = frameworkId(effective);
            if (plan.route == BackgroundRoute::Pen) {
                ensureVisibleForPen(process.hwnd, process.pid, from, effective, "drags");
                ensureInputDesktop();
                BackgroundGuard guard(process.hwnd, process.pid, false, kBackgroundWatchMs);
                guard.injectedAt(from);
                guard.injectedAt(to);
                penDrag(from, to, 16);
                guard.finish();
                route = "pointer.pen.drag";
            } else {
                BackgroundGuard guard(process.hwnd, process.pid, false, kBackgroundWatchMs);
                sendDrag(process.hwnd, from, to);
                guard.finish();
                route = "hwnd.postmessage.drag";
            }
            delivery = "background";
        }
    } else if (tool == "type_text") {
        std::wstring text = toWide(operation.str("text"));
        if (!background) {
            withForegroundInput(process.hwnd, foregroundRestore, [&] {
                sendForegroundText(process.hwnd, process.pid, text);
            });
            delivery = "foreground";
            deliveryReason = "requested";
            route = "foreground.sendinput.text";
        } else {
            std::string textRoute = runUia([&] { return typeTextIntoField(uia, root, process, framework, text); });
            if (!textRoute.empty()) {
                route = textRoute;
                delivery = textRoute.rfind("uia.", 0) == 0 ? "uia" : "background";
            } else {
                Framework keys = keyboardFramework();
                BackgroundPlan plan = keyboardPlan(keys, "text", "");
                if (plan.route == BackgroundRoute::Refuse) throw backgroundUnavailable(keys, "typing", plan);
                ensureCanPostMessages(process.pid);
                sendText(process.hwnd, text);
                delivery = "background";
                route = "hwnd.postmessage.text";
            }
            deliveryReason = frameworkId(framework);
        }
    } else if (tool == "press_key") {
        std::string key = operation.str("key");
        if (!background) {
            withForegroundInput(process.hwnd, foregroundRestore, [&] {
                sendForegroundKey(process.hwnd, process.pid, key);
            });
            delivery = "foreground";
            deliveryReason = "requested";
            route = "foreground.sendinput.key";
        } else {
            Framework keys = keyboardFramework();
            BackgroundPlan plan = keyboardPlan(keys, "key", key);
            if (plan.route == BackgroundRoute::Refuse) throw backgroundUnavailable(keys, "keys", plan);
            ensureCanPostMessages(process.pid);
            sendKey(process.hwnd, key);
            delivery = "background";
            deliveryReason = frameworkId(keys);
            route = "hwnd.postmessage.key";
        }
    } else if (tool == "set_value") {
        if (!element) throw std::runtime_error("unknown element_index '" + std::to_string(operationElementIndex(operation)) + "'");
        IUIAutomationValuePattern* value = getPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
        if (!value) throw std::runtime_error("Cannot set a value for an element that is not settable");
        std::wstring next = toWide(operation.str("value"));
        BSTR bstr = SysAllocString(next.c_str());
        HRESULT hr = runUia([&] { return value->SetValue(bstr); });
        SysFreeString(bstr);
        value->Release();
        if (FAILED(hr)) throw std::runtime_error("Cannot set a value for an element that is not settable");
        route = "uia.value.set";
        delivery = "uia";
    } else if (tool == "select_text") {
        if (!element) throw std::runtime_error("unknown element_index '" + std::to_string(operationElementIndex(operation)) + "'");
        runUia([&] {
            selectExactText(
                element,
                toWide(operation.str("text")),
                toWide(operation.str("prefix")),
                toWide(operation.str("suffix")),
                operation.str("selection", "text"));
            return true;
        });
        route = "uia.text.select";
        delivery = "uia";
    } else {
        throw std::runtime_error("unsupportedTool(\"" + tool + "\")");
    }

    if (targetState.pendingActionCount == 0) {
        targetState.pendingBaselineRevision = baselineRevision;
        targetState.pendingBaselineEventCount = baselineEventCount;
    }
    targetState.lastActionBaselineEventCount = baselineEventCount;
    targetState.pendingActionCount += 1;
    targetState.visualContextNeeded = targetState.visualContextNeeded ||
        tool == "click" || tool == "scroll" || tool == "drag" ||
        tool == "press_key" || tool == "perform_secondary_action";
    if (targetState.tracker) targetState.tracker->invalidateForAction();
    unsigned long long invalidatedRevision = targetState.tracker
        ? targetState.tracker->revision.load()
        : baselineRevision + 1;
    bool deferred = operationBool(operation, "defer_observation");
    if (deferred) {
        std::string response = "{\"ok\":true,\"receipt\":" +
            receiptJson(probe, route, dispatch, nullptr, true, baselineRevision, invalidatedRevision, targetState.pendingActionCount, delivery, deliveryReason, &foregroundRestore) +
            ",\"revision\":" + std::to_string(invalidatedRevision) + ",\"deferred\":true}";
        safeRelease(element);
        safeRelease(root);
        return response;
    }

    AdaptiveSettle settle = waitForTargetQuiet(
        uia,
        targetState,
        targetState.pendingBaselineRevision,
        targetState.pendingBaselineEventCount);
    Snapshot refreshed = snapshotForTarget(uia, targetState, operationScreenshotPolicy(operation));
    refreshed.settleWaitedMs = settle.waitedMs;
    refreshed.settleEventCount = settle.eventCount;
    refreshed.settleTimedOut = settle.timedOut;
    refreshed.settleBaselineRevision = settle.baselineRevision;
    refreshed.settleFinalRevision = settle.finalRevision;
    std::string response = "{\"ok\":true,\"receipt\":" +
        receiptJson(probe, route, dispatch, &settle, false, baselineRevision, settle.finalRevision, targetState.pendingActionCount, delivery, deliveryReason, &foregroundRestore) +
        ",\"revision\":" + std::to_string(settle.finalRevision) +
        ",\"deferred\":false,\"snapshot\":" + snapshotJson(refreshed) + "}";
    targetState.pendingActionCount = 0;
    targetState.visualContextNeeded = false;
    safeRelease(element);
    safeRelease(root);
    return response;
    } catch (...) {
        safeRelease(element);
        safeRelease(root);
        throw;
    }
}

int main(int argc, char** argv) {
    processPerMonitorDpiAware = enablePerMonitorDpiAwareness();
    SetConsoleOutputCP(CP_UTF8);
    bool daemonMode = argc >= 2 && std::string(argv[1] ? argv[1] : "") == "daemon";
    if (!daemonMode && argc != 2) {
        printf("%s\n", failJson("Usage: stella-computer-helper.exe <operation.json> | daemon --pipe-name PIPE --pid-file PATH").c_str());
        return 0;
    }

    ComInit com;
    if (!com.ok) {
        printf("%s\n", failJson("COM initialization failed").c_str());
        return 0;
    }

    ULONG_PTR gdiplusToken = 0;
    Gdiplus::GdiplusStartupInput gdiplusInput;
    Gdiplus::GdiplusStartup(&gdiplusToken, &gdiplusInput, NULL);

    IUIAutomation* uia = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(CUIAutomation), NULL, CLSCTX_INPROC_SERVER,
                                  __uuidof(IUIAutomation), reinterpret_cast<void**>(&uia));
    if (FAILED(hr) || !uia) {
        if (gdiplusToken) Gdiplus::GdiplusShutdown(gdiplusToken);
        printf("%s\n", failJson("UI Automation initialization failed").c_str());
        return 0;
    }

    recoverDisabledWindow();

    // Start the passive overlay only after GDI+ and UI Automation are ready;
    // the helper's process lifetime owns it in both one-shot and daemon mode.
    if (!envFlag("STELLA_COMPUTER_NO_OVERLAY")) {
        gAgentCursorOverlay = new AgentCursorOverlay();
    }

    if (daemonMode) {
        try {
            int code = runDaemon(uia, parseDaemonOptions(argc, argv));
            delete gAgentCursorOverlay;
            gAgentCursorOverlay = nullptr;
            releaseAllTargetStates(uia);
            safeRelease(uia);
            if (gdiplusToken) Gdiplus::GdiplusShutdown(gdiplusToken);
            return code;
        } catch (const std::exception& error) {
            delete gAgentCursorOverlay;
            gAgentCursorOverlay = nullptr;
            releaseAllTargetStates(uia);
            safeRelease(uia);
            if (gdiplusToken) Gdiplus::GdiplusShutdown(gdiplusToken);
            printf("%s\n", failJson(error.what()).c_str());
            return 0;
        }
    }

    try {
        std::ifstream input(argv[1], std::ios::binary);
        std::stringstream buffer;
        buffer << input.rdbuf();
        JsonParser parser(buffer.str());
        Json operation = parser.parseValue();
        std::string response = executeOperation(uia, operation);
        fwrite(response.c_str(), 1, response.size(), stdout);
        fwrite("\n", 1, 1, stdout);
    } catch (const CodedError& error) {
        std::string response = failJson(error.what(), error.code);
        fwrite(response.c_str(), 1, response.size(), stdout);
        fwrite("\n", 1, 1, stdout);
    } catch (const std::exception& error) {
        std::string response = failJson(error.what());
        fwrite(response.c_str(), 1, response.size(), stdout);
        fwrite("\n", 1, 1, stdout);
    }

    delete gAgentCursorOverlay;
    gAgentCursorOverlay = nullptr;
    releaseAllTargetStates(uia);
    safeRelease(uia);
    if (gdiplusToken) Gdiplus::GdiplusShutdown(gdiplusToken);
    return 0;
}
