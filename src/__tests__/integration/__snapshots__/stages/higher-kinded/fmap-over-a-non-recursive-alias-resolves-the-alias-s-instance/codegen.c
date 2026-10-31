## stringify (foreign)


## Functor (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_31(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_31, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_31(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
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

## fmap (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_39(YapValue* __args, int __argc);

static YapValue closure_38(YapValue* __args, int __argc);

static YapValue closure_37(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", Functor);
  yap_record_set(&env_cls2, "v1", cap1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_37, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_39(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  return cap_0;
}

static YapValue closure_38(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue functor1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", cap_0);
  yap_record_set(&env_cls2, "v1", cap_1);
  yap_record_set(&env_cls2, "v2", functor1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_39, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_37(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", cap_1);
  yap_record_set(&env_cls2, "v1", f1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_38, yap_null());
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

## Option (let)
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
  YapValue a1 = __args[1];
  YapValue v0 = yap_atom("Unit");
  YapValue v1 = yap_alloc_record(2);
  yap_record_set(&v1, "none", v0);
  yap_record_set(&v1, "some", a1);
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

## mapOption (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_46(YapValue* __args, int __argc);

static YapValue closure_45(YapValue* __args, int __argc);

static YapValue closure_44(YapValue* __args, int __argc);

static YapValue closure_43(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", Option);
  YapValue fnref_cls2 = yap_mk_closure(&closure_43, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_46(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue o1 = __args[1];
  int yap_pc = 0;
  YapValue match1;
  while (1) {
  switch (yap_pc) {
  case 0: {
    YapValue cap_0 = yap_record_get(env0, "v0");
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue tag0 = yap_record_get(o1, "__tag");
    if (yap_streq(yap_to_str(tag0), "some")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(tag0), "none")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v5 = yap_record_get(o1, "payload");
    YapValue x = v5;
    YapValue v6 = yap_atom("some");
    YapValue fnref7 = yap_record_get(cap_0, "__fn");
    YapValue env8 = yap_record_get(cap_0, "__env");
    YapValue v9 = yap_call_closure(fnref7, (YapValue[]){env8, x}, 2);
    YapValue v10 = yap_alloc_record(2);
    yap_record_set(&v10, "__tag", v6);
    yap_record_set(&v10, "payload", v9);
    YapValue __t0 = v10;
    match1 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v6 = yap_atom("none");
    YapValue v7 = yap_null();
    YapValue v8 = yap_alloc_record(2);
    yap_record_set(&v8, "__tag", v6);
    yap_record_set(&v8, "payload", v7);
    YapValue __t0 = v8;
    match1 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match1;
  }
}
}
}

static YapValue closure_45(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", f1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_46, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_44(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue b1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", cap_1);
  yap_record_set(&env_cls2, "v1", cap_0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_45, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_43(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", a1);
  yap_record_set(&env_cls2, "v1", cap_0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_44, yap_null());
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

## OptionFunctor (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = mapOption;
  YapValue v1 = yap_alloc_record(1);
  yap_record_set(&v1, "map", v0);
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

## (using) (using)


## x (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("some");
  YapValue v1 = yap_num(1);
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "__tag", v0);
  yap_record_set(&v2, "payload", v1);
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

## y (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue pap_fn18(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue v0 = fmap;
  YapValue v1 = Option;
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = OptionFunctor;
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  YapValue v9 = yap_atom("Num");
  YapValue fnref10 = yap_record_get(v8, "__fn");
  YapValue env11 = yap_record_get(v8, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  YapValue v13 = yap_atom("String");
  YapValue fnref14 = yap_record_get(v12, "__fn");
  YapValue env15 = yap_record_get(v12, "__env");
  YapValue v16 = yap_call_closure(fnref14, (YapValue[]){env15, v13}, 2);
  YapValue v17 = yap_atom("Num");
  YapValue env_cls18 = yap_alloc_record(1);
  yap_record_set(&env_cls18, "v0", v17);
  YapValue fnref_cls18 = yap_mk_closure(&pap_fn18, yap_null());
  YapValue closure_cls18 = yap_alloc_record(2);
  yap_record_set(&closure_cls18, "__fn", fnref_cls18);
  yap_record_set(&closure_cls18, "__env", env_cls18);
  YapValue fnref19 = yap_record_get(v16, "__fn");
  YapValue env20 = yap_record_get(v16, "__env");
  YapValue v21 = yap_call_closure(fnref19, (YapValue[]){env20, closure_cls18}, 2);
  YapValue v22 = x;
  YapValue fnref23 = yap_record_get(v21, "__fn");
  YapValue env24 = yap_record_get(v21, "__env");
  YapValue v25 = yap_call_closure(fnref23, (YapValue[]){env24, v22}, 2);
  return v25;
}

static YapValue pap_fn18(YapValue* __args, int __argc) {
  YapValue env19 = __args[0];
  YapValue arg20 = __args[1];
  YapValue cap_0 = yap_record_get(env19, "v0");
  YapValue result_pap_fn18 = stringify(cap_0, arg20);
  return result_pap_fn18;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
