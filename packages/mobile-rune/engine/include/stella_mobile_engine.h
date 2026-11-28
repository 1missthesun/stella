// C API of stella-mobile-engine (packages/mobile-rune/engine/src/ffi.rs).
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SmeHost SmeHost;
typedef void (*sme_event_cb)(void *ctx, const uint8_t *json, size_t len);
typedef void (*sme_wake_cb)(void *ctx);

typedef struct {
  bool drew;
  bool animating;
  double wake_after; // seconds; negative = none scheduled
  uint64_t cpu_us;
} SmeFrame;

void sme_init(sme_event_cb events, sme_event_cb native, void *ctx);
void sme_push(const uint8_t *bytes, size_t len);
SmeHost *sme_create(void *metal_layer, float w, float h, float scale, bool dark, sme_wake_cb wake, void *ctx);
void sme_destroy(SmeHost *h);
SmeFrame sme_frame(SmeHost *h);
void sme_resize(SmeHost *h, float w, float ht, float scale);
void sme_safe_area(SmeHost *h, float top, float right, float bottom, float left);
void sme_set_dark(SmeHost *h, bool dark);
void sme_keyboard(SmeHost *h, float height);
/// Where the keyboard is on the frame about to be drawn (points); call right before sme_frame.
void sme_keyboard_frame(SmeHost *h, float height);
/** Reduce Transparency (glass turns solid), Increase Contrast, Reduce Motion. */
void sme_accessibility(SmeHost *h, bool reduce_transparency, bool increase_contrast, bool reduce_motion);
void sme_touch(SmeHost *h, uint64_t id, uint32_t phase, float x, float y, double time);
void sme_field_event(uint32_t node, const uint8_t *json, size_t len);

#ifdef __cplusplus
}
#endif
