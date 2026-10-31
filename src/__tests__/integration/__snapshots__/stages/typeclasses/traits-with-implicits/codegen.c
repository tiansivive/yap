## stringify (foreign)


## Show (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_18(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", String);
  YapValue fnref_cls2 = yap_mk_closure(&closure_18, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_18(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_alloc_record(0);
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

## Eq (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_20(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", Bool);
  YapValue fnref_cls2 = yap_mk_closure(&closure_20, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_20(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_alloc_record(0);
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

## ShowNum (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue pap_fn1(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("Num");
  YapValue env_cls1 = yap_alloc_record(1);
  yap_record_set(&env_cls1, "v0", v0);
  YapValue fnref_cls1 = yap_mk_closure(&pap_fn1, yap_null());
  YapValue closure_cls1 = yap_alloc_record(2);
  yap_record_set(&closure_cls1, "__fn", fnref_cls1);
  yap_record_set(&closure_cls1, "__env", env_cls1);
  YapValue v2 = yap_alloc_record(1);
  yap_record_set(&v2, "show", closure_cls1);
  return v2;
}

static YapValue pap_fn1(YapValue* __args, int __argc) {
  YapValue env2 = __args[0];
  YapValue arg3 = __args[1];
  YapValue cap_0 = yap_record_get(env2, "v0");
  YapValue result_pap_fn1 = stringify(cap_0, arg3);
  return result_pap_fn1;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## EqNum (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_mk_closure(&unknown, yap_null());
  YapValue v1 = yap_alloc_record(1);
  yap_record_set(&v1, "eq", v0);
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

## display (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_19(YapValue* __args, int __argc);

static YapValue closure_18(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", Show);
  YapValue fnref_cls2 = yap_mk_closure(&closure_18, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_19(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue show1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_record_get(show1, "show");
  return v0;
}

static YapValue closure_18(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", t1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_19, yap_null());
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

## areEqual (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_23(YapValue* __args, int __argc);

static YapValue closure_22(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", Eq);
  YapValue fnref_cls2 = yap_mk_closure(&closure_22, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_23(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue eq1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_record_get(eq1, "eq");
  return v0;
}

static YapValue closure_22(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", t1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_23, yap_null());
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


## (using) (using)


## shown (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = display;
  YapValue v1 = yap_atom("Num");
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = ShowNum;
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  YapValue v9 = yap_num(42);
  YapValue fnref10 = yap_record_get(v8, "__fn");
  YapValue env11 = yap_record_get(v8, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  return v12;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## same (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = areEqual;
  YapValue v1 = yap_atom("Num");
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = EqNum;
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  YapValue v9 = yap_num(10);
  YapValue fnref10 = yap_record_get(v8, "__fn");
  YapValue env11 = yap_record_get(v8, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  YapValue v13 = yap_num(10);
  YapValue fnref14 = yap_record_get(v12, "__fn");
  YapValue env15 = yap_record_get(v12, "__env");
  YapValue v16 = yap_call_closure(fnref14, (YapValue[]){env15, v13}, 2);
  return v16;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
