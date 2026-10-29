## Shape (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_alloc_record(0);
  YapValue v1 = Num;
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "1", v1);
  yap_record_set(&v2, "0", v1);
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "point", v0);
  yap_record_set(&v3, "rectangle", v2);
  yap_record_set(&v3, "circle", v1);
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

## describeShape (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_68(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_68, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_68(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue s1 = __args[1];
  int yap_pc = 0;
  YapValue match1;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue tag0 = yap_record_get(s1, "__tag");
    if (yap_streq(yap_to_str(tag0), "circle")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(tag0), "rectangle")) {
  yap_pc = 3;
  break;
}
    if (yap_streq(yap_to_str(tag0), "point")) {
  yap_pc = 4;
  break;
}
  }
  case 2: {
    YapValue v5 = yap_record_get(s1, "payload");
    YapValue r = v5;
    YapValue v6 = yap_str("Circle with radius");
    YapValue __t0 = v6;
    match1 = __t0;
    yap_pc = 5;
    break;
  }
  case 3: {
    YapValue v6 = yap_record_get(s1, "payload");
    YapValue v7 = yap_record_get(v6, "0");
    YapValue w = v7;
    YapValue v8 = yap_record_get(v6, "1");
    YapValue h = v8;
    YapValue v9 = yap_str("Rectangle");
    YapValue __t0 = v9;
    match1 = __t0;
    yap_pc = 5;
    break;
  }
  case 4: {
    YapValue v7 = yap_record_get(s1, "payload");
    YapValue v8 = yap_str("Point at coordinates");
    YapValue __t0 = v8;
    match1 = __t0;
    yap_pc = 5;
    break;
  }
  case 5: {
    return match1;
  }
}
}
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}
