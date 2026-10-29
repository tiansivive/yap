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

## displayIfEqual (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_69(YapValue* __args, int __argc);

static YapValue closure_68(YapValue* __args, int __argc);

static YapValue closure_67(YapValue* __args, int __argc);

static YapValue closure_66(YapValue* __args, int __argc);

static YapValue closure_65(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_65, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_69(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue y1 = __args[1];
  int yap_pc = 0;
  YapValue match7;
  while (1) {
  switch (yap_pc) {
  case 0: {
    YapValue cap_0 = yap_record_get(env0, "v0");
    YapValue cap_1 = yap_record_get(env0, "v1");
    YapValue cap_2 = yap_record_get(env0, "v2");
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue v0 = yap_record_get(cap_0, "eq");
    YapValue fnref1 = yap_record_get(v0, "__fn");
    YapValue env2 = yap_record_get(v0, "__env");
    YapValue v3 = yap_call_closure(fnref1, (YapValue[]){env2, cap_1}, 2);
    YapValue fnref4 = yap_record_get(v3, "__fn");
    YapValue env5 = yap_record_get(v3, "__env");
    YapValue v6 = yap_call_closure(fnref4, (YapValue[]){env5, y1}, 2);
    if (yap_streq(yap_to_str(v6), "true")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(v6), "false")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v11 = yap_str("Equal: ");
    YapValue v12 = yap_record_get(cap_2, "show");
    YapValue fnref13 = yap_record_get(v12, "__fn");
    YapValue env14 = yap_record_get(v12, "__env");
    YapValue v15 = yap_call_closure(fnref13, (YapValue[]){env14, cap_1}, 2);
    YapValue v16 = yap_concat(v11, v15);
    YapValue __t0 = v16;
    match7 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v12 = yap_str("Not equal");
    YapValue __t0 = v12;
    match7 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match7;
  }
}
}
}

static YapValue closure_68(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", cap_1);
  yap_record_set(&env_cls2, "v1", x1);
  yap_record_set(&env_cls2, "v2", cap_2);
  YapValue fnref_cls2 = yap_mk_closure(&closure_69, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_67(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue eq1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", cap_0);
  yap_record_set(&env_cls2, "v1", eq1);
  yap_record_set(&env_cls2, "v2", cap_1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_68, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_66(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue show1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", cap_0);
  yap_record_set(&env_cls2, "v1", show1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_67, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_65(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", t1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_66, yap_null());
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


## msg (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = displayIfEqual;
  YapValue v1 = yap_atom("Num");
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = ShowNum;
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  YapValue v9 = EqNum;
  YapValue fnref10 = yap_record_get(v8, "__fn");
  YapValue env11 = yap_record_get(v8, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  YapValue v13 = yap_num(5);
  YapValue fnref14 = yap_record_get(v12, "__fn");
  YapValue env15 = yap_record_get(v12, "__env");
  YapValue v16 = yap_call_closure(fnref14, (YapValue[]){env15, v13}, 2);
  YapValue v17 = yap_num(5);
  YapValue fnref18 = yap_record_get(v16, "__fn");
  YapValue env19 = yap_record_get(v16, "__env");
  YapValue v20 = yap_call_closure(fnref18, (YapValue[]){env19, v17}, 2);
  return v20;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
