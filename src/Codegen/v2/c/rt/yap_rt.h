#ifndef YAP_RT_H
#define YAP_RT_H

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* ─── Arena allocator ─── */

#define YAP_ARENA_SIZE (1024 * 1024)

static char* yap_arena_buf = NULL;
static size_t yap_arena_off = 0;

static void yap_arena_init(void) {
    yap_arena_buf = (char*)malloc(YAP_ARENA_SIZE);
    yap_arena_off = 0;
}

static void* yap_arena_alloc(size_t size) {
    size = (size + 7) & ~7; /* 8-byte align */
    if (yap_arena_off + size > YAP_ARENA_SIZE) {
        fprintf(stderr, "yap: arena exhausted\n");
        exit(1);
    }
    void* p = yap_arena_buf + yap_arena_off;
    yap_arena_off += size;
    return p;
}

static void yap_arena_free(void) {
    free(yap_arena_buf);
    yap_arena_buf = NULL;
    yap_arena_off = 0;
}

/* ─── Value representation ─── */

typedef enum {
    VAL_NUM, VAL_BOOL, VAL_STR, VAL_ATOM,
    VAL_RECORD, VAL_CLOSURE, VAL_NULL
} YapTag;

typedef struct YapValue YapValue;
typedef struct YapRecord YapRecord;
typedef struct YapClosure YapClosure;

typedef YapValue (*YapFnPtr)(YapValue*, int);

struct YapValue {
    YapTag tag;
    union {
        int64_t num;
        int b;
        const char* str;
        YapRecord* rec;
        YapClosure* cls;
    } as;
};

typedef struct { const char* key; YapValue val; } YapField;

struct YapRecord {
    int count;
    int capacity;
    YapField* fields;
};

struct YapClosure {
    YapFnPtr fn;
    YapValue env;
};

/* ─── Constructors ─── */

static YapValue yap_num(int64_t n) {
    YapValue v; v.tag = VAL_NUM; v.as.num = n; return v;
}
static YapValue yap_bool(int b) {
    YapValue v; v.tag = VAL_BOOL; v.as.b = b; return v;
}
static YapValue yap_str(const char* s) {
    YapValue v; v.tag = VAL_STR; v.as.str = s; return v;
}
static YapValue yap_atom(const char* s) {
    YapValue v; v.tag = VAL_ATOM; v.as.str = s; return v;
}
static YapValue yap_null(void) {
    YapValue v; v.tag = VAL_NULL; v.as.num = 0; return v;
}

/* ─── Records ─── */

static YapValue yap_alloc_record(int capacity) {
    YapRecord* r = (YapRecord*)yap_arena_alloc(sizeof(YapRecord));
    r->count = 0;
    r->capacity = capacity > 0 ? capacity : 4;
    r->fields = (YapField*)yap_arena_alloc(sizeof(YapField) * r->capacity);
    YapValue v; v.tag = VAL_RECORD; v.as.rec = r;
    return v;
}

static void yap_record_set(YapValue* rec, const char* key, YapValue val) {
    YapRecord* r = rec->as.rec;
    for (int i = 0; i < r->count; i++) {
        if (strcmp(r->fields[i].key, key) == 0) {
            r->fields[i].val = val;
            return;
        }
    }
    if (r->count >= r->capacity) {
        int new_cap = r->capacity * 2;
        YapField* new_fields = (YapField*)yap_arena_alloc(sizeof(YapField) * new_cap);
        memcpy(new_fields, r->fields, sizeof(YapField) * r->count);
        r->fields = new_fields;
        r->capacity = new_cap;
    }
    r->fields[r->count].key = key;
    r->fields[r->count].val = val;
    r->count++;
}

static YapValue yap_record_get(YapValue rec, const char* key) {
    YapRecord* r = rec.as.rec;
    for (int i = 0; i < r->count; i++) {
        if (strcmp(r->fields[i].key, key) == 0) {
            return r->fields[i].val;
        }
    }
    fprintf(stderr, "yap: record field not found: %s\n", key);
    exit(1);
}

static YapValue yap_record_copy(YapValue src) {
    YapRecord* s = src.as.rec;
    YapValue dst = yap_alloc_record(s->capacity);
    YapRecord* d = dst.as.rec;
    memcpy(d->fields, s->fields, sizeof(YapField) * s->count);
    d->count = s->count;
    return dst;
}

static YapValue yap_record_copy_with(YapValue src, YapField* updates, int n) {
    YapValue dst = yap_record_copy(src);
    for (int i = 0; i < n; i++) {
        yap_record_set(&dst, updates[i].key, updates[i].val);
    }
    return dst;
}

/* ─── Closures ─── */

static YapValue yap_mk_closure(YapFnPtr fn, YapValue env) {
    YapClosure* c = (YapClosure*)yap_arena_alloc(sizeof(YapClosure));
    c->fn = fn;
    c->env = env;
    YapValue v; v.tag = VAL_CLOSURE; v.as.cls = c;
    return v;
}

static YapValue yap_call_closure(YapValue cls, YapValue* args, int argc) {
    return cls.as.cls->fn(args, argc);
}

/* ─── String helpers ─── */

static const char* yap_to_str(YapValue v) {
    static char buf[64];
    switch (v.tag) {
        case VAL_STR:  return v.as.str;
        case VAL_ATOM: return v.as.str;
        case VAL_NUM:  snprintf(buf, sizeof(buf), "%lld", (long long)v.as.num); return buf;
        case VAL_BOOL: return v.as.b ? "true" : "false";
        case VAL_NULL: return "null";
        default:       return "<record/closure>";
    }
}

static int yap_streq(const char* a, const char* b) {
    return strcmp(a, b) == 0;
}

/* ─── String allocation ─── */

static const char* yap_arena_strdup(const char* s) {
    size_t len = strlen(s) + 1;
    char* p = (char*)yap_arena_alloc(len);
    memcpy(p, s, len);
    return p;
}

static const char* yap_concat_str(const char* a, const char* b) {
    size_t la = strlen(a), lb = strlen(b);
    char* p = (char*)yap_arena_alloc(la + lb + 1);
    memcpy(p, a, la);
    memcpy(p + la, b, lb + 1);
    return p;
}

/* ─── PrimOps ─── */

static YapValue yap_add(YapValue a, YapValue b) { return yap_num(a.as.num + b.as.num); }
static YapValue yap_sub(YapValue a, YapValue b) { return yap_num(a.as.num - b.as.num); }
static YapValue yap_mul(YapValue a, YapValue b) { return yap_num(a.as.num * b.as.num); }
static YapValue yap_div(YapValue a, YapValue b) { return yap_num(a.as.num / b.as.num); }
static YapValue yap_mod(YapValue a, YapValue b) { return yap_num(a.as.num % b.as.num); }

static YapValue yap_and(YapValue a, YapValue b) { return yap_bool(a.as.b && b.as.b); }
static YapValue yap_or(YapValue a, YapValue b)  { return yap_bool(a.as.b || b.as.b); }
static YapValue yap_not(YapValue a)              { return yap_bool(!a.as.b); }

static int yap_val_eq(YapValue a, YapValue b) {
    if (a.tag != b.tag) return 0;
    switch (a.tag) {
        case VAL_NUM:  return a.as.num == b.as.num;
        case VAL_BOOL: return a.as.b == b.as.b;
        case VAL_STR:  return strcmp(a.as.str, b.as.str) == 0;
        case VAL_ATOM: return strcmp(a.as.str, b.as.str) == 0;
        case VAL_NULL: return 1;
        default:       return a.as.rec == b.as.rec;
    }
}

static YapValue yap_eq(YapValue a, YapValue b)  { return yap_bool(yap_val_eq(a, b)); }
static YapValue yap_neq(YapValue a, YapValue b) { return yap_bool(!yap_val_eq(a, b)); }
static YapValue yap_lt(YapValue a, YapValue b)  { return yap_bool(a.as.num < b.as.num); }
static YapValue yap_gt(YapValue a, YapValue b)  { return yap_bool(a.as.num > b.as.num); }
static YapValue yap_lte(YapValue a, YapValue b) { return yap_bool(a.as.num <= b.as.num); }
static YapValue yap_gte(YapValue a, YapValue b) { return yap_bool(a.as.num >= b.as.num); }

static YapValue yap_concat(YapValue a, YapValue b) {
    return yap_str(yap_concat_str(yap_to_str(a), yap_to_str(b)));
}

/* ─── Print ─── */

static void yap_print_value(YapValue v) {
    switch (v.tag) {
        case VAL_NUM:  printf("%lld", (long long)v.as.num); break;
        case VAL_BOOL: printf("%s", v.as.b ? "true" : "false"); break;
        case VAL_STR:  printf("\"%s\"", v.as.str); break;
        case VAL_ATOM: printf("%s", v.as.str); break;
        case VAL_NULL: printf("null"); break;
        case VAL_CLOSURE: printf("<closure>"); break;
        case VAL_RECORD: {
            YapRecord* r = v.as.rec;
            printf("{");
            for (int i = 0; i < r->count; i++) {
                if (i > 0) printf(", ");
                printf("%s: ", r->fields[i].key);
                yap_print_value(r->fields[i].val);
            }
            printf("}");
            break;
        }
    }
}

#endif /* YAP_RT_H */
