## addImplicit (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_17(YapValue* __args, int __argc);

static YapValue closure_16(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_16, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_17(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_add(x1, cap_0);
  return v0;
}

static YapValue closure_16(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue n1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", n1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_17, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## (using) (using)


## eleven (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = addImplicit;
  YapValue v1 = yap_num(10);
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = yap_num(1);
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  return v8;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## fifteen (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = addImplicit;
  YapValue v1 = yap_num(10);
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = yap_num(5);
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  return v8;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
