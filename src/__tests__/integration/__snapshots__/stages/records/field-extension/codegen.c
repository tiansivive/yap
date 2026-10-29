## point (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(10);
  YapValue v1 = yap_alloc_record(1);
  yap_record_set(&v1, "x", v0);
  return v1;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## point3d (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(30);
  YapValue v1 = yap_num(20);
  YapValue v2 = point;
  YapValue v3 = yap_record_copy_with(v2, (YapField[]){{"y", v1}}, 1);
  YapValue v4 = yap_record_copy_with(v3, (YapField[]){{"z", v0}}, 1);
  return v4;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## updated (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(100);
  YapValue v1 = point;
  YapValue v2 = yap_record_copy_with(v1, (YapField[]){{"x", v0}}, 1);
  return v2;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## updatedX (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = updated;
  YapValue v1 = yap_record_get(v0, "x");
  return v1;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
