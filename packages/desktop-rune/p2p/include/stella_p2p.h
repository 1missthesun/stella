/* Stella direct device link (crate stella-p2p, built with --features ffi as a staticlib).
 * Every string is UTF-8 JSON; the commands and events are listed in src/lib.rs.
 * Callbacks run on the link's own threads and must copy the string before returning.
 * `ctx` is handed back unchanged and must be safe to use from any thread.
 * stella_p2p_command uses `node` only while it runs: never stop a node while a command on it is
 * still inside stella_p2p_command. Once stella_p2p_stop returns, no callback of that node runs
 * again, so its `ctx` may be freed; never call stella_p2p_stop from inside a callback. */
#ifndef STELLA_P2P_H
#define STELLA_P2P_H
#include <stdint.h>

typedef struct StellaP2pNode StellaP2pNode;
typedef void (*stella_p2p_event_cb)(void *ctx, const char *json);
typedef void (*stella_p2p_reply_cb)(void *ctx, uint64_t token, const char *json);

/* config: {"dataDir": "...", "name": "iPhone", "platform": "ios", "relay": "default"|"off"|"<url>"} */
StellaP2pNode *stella_p2p_start(const char *config_json, stella_p2p_event_cb on_event, void *ctx);
/* reply json: {"ok": true, "value": ...} or {"ok": false, "error": "..."} */
void stella_p2p_command(StellaP2pNode *node, const char *cmd, const char *args_json, uint64_t token, stella_p2p_reply_cb reply, void *ctx);
void stella_p2p_stop(StellaP2pNode *node);

#ifdef __ANDROID__
/* Once, before the first stella_p2p_start (from JNI_OnLoad, say): the JavaVM* and a global
 * reference to an Android Context, which Iroh needs to read the system's DNS servers. */
void stella_p2p_android_init(void *java_vm, void *android_context);
#endif

#endif
