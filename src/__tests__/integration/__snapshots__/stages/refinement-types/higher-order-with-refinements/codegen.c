## Nat (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  return v0;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## Pos (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  return v0;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## hof (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_13(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_13, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_13(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
  YapValue v0 = yap_num(1);
  YapValue fnref1 = yap_record_get(f1, "__fn");
  YapValue env2 = yap_record_get(f1, "__env");
  YapValue v3 = yap_call_closure(fnref1, (YapValue[]){env2, v0}, 2);
  return v3;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## hof2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_18(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_18, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_18(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
  YapValue v0 = yap_num(1);
  YapValue fnref1 = yap_record_get(f1, "__fn");
  YapValue env2 = yap_record_get(f1, "__env");
  YapValue v3 = yap_call_closure(fnref1, (YapValue[]){env2, v0}, 2);
  YapValue v4 = yap_num(1);
  YapValue v5 = yap_add(v3, v4);
  return v5;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
