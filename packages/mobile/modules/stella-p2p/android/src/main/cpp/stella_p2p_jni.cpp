// JNI shim over the stella-p2p C API (include/stella_p2p.h) for StellaP2pNative.kt.
// Strings cross as UTF-8 byte arrays both ways: JNI's own string calls use modified UTF-8, which
// mangles anything outside the BMP (emoji in a chat).

#include <jni.h>
#include <android/log.h>
#include <cstring>
#include <string>
#include <vector>

extern "C" {
#include "stella_p2p.h"
}

namespace {

JavaVM *g_vm = nullptr;

// One per started node: the Kotlin listener its callbacks reach.
struct Ctx {
  jobject listener;  // global ref
  jmethodID on_event;
  jmethodID on_reply;
};

// The link calls back on its own (long-lived) threads; attach them once, as daemons.
JNIEnv *env_for_thread() {
  JNIEnv *env = nullptr;
  if (g_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_OK) return env;
  JavaVMAttachArgs args{JNI_VERSION_1_6, "stella-p2p", nullptr};
  if (g_vm->AttachCurrentThreadAsDaemon(&env, &args) != JNI_OK) return nullptr;
  return env;
}

jbyteArray bytes(JNIEnv *env, const char *text) {
  const jsize len = text ? static_cast<jsize>(std::strlen(text)) : 0;
  jbyteArray array = env->NewByteArray(len);
  if (array && len > 0) env->SetByteArrayRegion(array, 0, len, reinterpret_cast<const jbyte *>(text));
  return array;
}

std::string text(JNIEnv *env, jbyteArray array) {
  if (!array) return {};
  const jsize len = env->GetArrayLength(array);
  std::string out(static_cast<size_t>(len), '\0');
  if (len > 0) env->GetByteArrayRegion(array, 0, len, reinterpret_cast<jbyte *>(out.data()));
  return out;
}

void on_event(void *raw, const char *json) {
  auto *ctx = static_cast<Ctx *>(raw);
  JNIEnv *env = env_for_thread();
  if (!env || !ctx) return;
  jbyteArray payload = bytes(env, json);
  env->CallVoidMethod(ctx->listener, ctx->on_event, payload);
  if (env->ExceptionCheck()) env->ExceptionClear();
  env->DeleteLocalRef(payload);
}

void on_reply(void *raw, uint64_t token, const char *json) {
  auto *ctx = static_cast<Ctx *>(raw);
  JNIEnv *env = env_for_thread();
  if (!env || !ctx) return;
  jbyteArray payload = bytes(env, json);
  env->CallVoidMethod(ctx->listener, ctx->on_reply, static_cast<jlong>(token), payload);
  if (env->ExceptionCheck()) env->ExceptionClear();
  env->DeleteLocalRef(payload);
}

struct Node {
  StellaP2pNode *node;
  Ctx *ctx;
};

}  // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *) {
  g_vm = vm;
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL
Java_com_stella_p2p_StellaP2pNative_init(JNIEnv *env, jobject, jobject context) {
  // Iroh reads the system's DNS servers through this Context for the life of the process.
  stella_p2p_android_init(g_vm, env->NewGlobalRef(context));
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_stella_p2p_StellaP2pNative_start(JNIEnv *env, jobject, jbyteArray config, jobject listener) {
  jclass cls = env->GetObjectClass(listener);
  auto *ctx = new Ctx{
      env->NewGlobalRef(listener),
      env->GetMethodID(cls, "onEvent", "([B)V"),
      env->GetMethodID(cls, "onReply", "(J[B)V"),
  };
  env->DeleteLocalRef(cls);
  const std::string json = text(env, config);
  StellaP2pNode *node = stella_p2p_start(json.c_str(), on_event, ctx);
  if (!node) {
    env->DeleteGlobalRef(ctx->listener);
    delete ctx;
    return 0;
  }
  return reinterpret_cast<jlong>(new Node{node, ctx});
}

extern "C" JNIEXPORT void JNICALL
Java_com_stella_p2p_StellaP2pNative_command(JNIEnv *env, jobject, jlong handle, jbyteArray cmd, jbyteArray args, jlong token) {
  auto *node = reinterpret_cast<Node *>(handle);
  if (!node) return;
  const std::string name = text(env, cmd);
  const std::string json = text(env, args);
  stella_p2p_command(node->node, name.c_str(), json.c_str(), static_cast<uint64_t>(token), on_reply, node->ctx);
}

extern "C" JNIEXPORT void JNICALL
Java_com_stella_p2p_StellaP2pNative_stop(JNIEnv *env, jobject, jlong handle) {
  auto *node = reinterpret_cast<Node *>(handle);
  if (!node) return;
  stella_p2p_stop(node->node);
  env->DeleteGlobalRef(node->ctx->listener);
  delete node->ctx;
  delete node;
}
