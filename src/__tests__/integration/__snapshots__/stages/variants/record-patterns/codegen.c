## getY (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_30(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_30, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_30(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue p1 = __args[1];
  YapValue v0 = yap_record_get(p1, "x");
  YapValue a = v0;
  YapValue v1 = yap_record_get(p1, "y");
  YapValue b = v1;
  return b;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## getY2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_28(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_28, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_28(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue p1 = __args[1];
  YapValue v0 = yap_record_get(p1, "y");
  YapValue a = v0;
  return a;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
