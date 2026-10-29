## prepend (foreign)


## id (foreign)


## nums (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("Num");
  YapValue v1 = yap_num(42);
  YapValue v2 = yap_num(1);
  YapValue v3 = yap_num(2);
  YapValue v4 = yap_num(3);
  YapValue v5 = yap_alloc_record(3);
  yap_record_set(&v5, "0", v2);
  yap_record_set(&v5, "1", v3);
  yap_record_set(&v5, "2", v4);
  YapValue v6 = prepend(v0, v1, v5);
  return v6;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## strs (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("String");
  YapValue v1 = yap_str("a");
  YapValue v2 = yap_str("b");
  YapValue v3 = yap_str("c");
  YapValue v4 = yap_alloc_record(2);
  yap_record_set(&v4, "0", v2);
  yap_record_set(&v4, "1", v3);
  YapValue v5 = prepend(v0, v1, v4);
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
