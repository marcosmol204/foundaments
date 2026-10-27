/*
 * btree.c: a tiny in-memory B-tree, for learning.
 *
 * Each node stands in for one "page". T is the minimum degree:
 *   - every node holds at most 2T-1 keys (here: 3) and 2T children (here: 4)
 *   - every non-root node holds at least T-1 keys
 * Insertion splits full nodes on the way down (CLRS, ch. 18), so we never
 * have to walk back up the tree.
 *
 * Build & run:   cc -std=c11 -Wall -o btree btree.c && ./btree
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>

#define T 2                      /* minimum degree: tiny on purpose, so splits happen often */
#define MAX_KEYS (2 * T - 1)

typedef struct Node {
    int n;                       /* number of keys currently stored        */
    int keys[MAX_KEYS];          /* sorted keys                            */
    struct Node *child[2 * T];   /* child[i] holds keys < keys[i]          */
    bool leaf;                   /* leaf pages hold data; internal pages route */
} Node;

static int pages_visited;        /* our stand-in for "disk reads"          */

static Node *node_new(bool leaf) {
    Node *x = calloc(1, sizeof *x);
    x->leaf = leaf;
    return x;
}

/* ---------- search: one page per level ---------- */
static bool btree_search(Node *x, int k) {
    pages_visited++;
    int i = 0;
    while (i < x->n && k > x->keys[i]) i++;          /* find first key >= k   */
    if (i < x->n && k == x->keys[i]) return true;    /* found on this page    */
    if (x->leaf) return false;                       /* nowhere left to go    */
    return btree_search(x->child[i], k);             /* descend one level     */
}

/* ---------- split: a full child becomes two half-full children ---------- */
static void split_child(Node *parent, int i) {
    Node *full = parent->child[i];
    Node *right = node_new(full->leaf);
    right->n = T - 1;

    for (int j = 0; j < T - 1; j++)                  /* upper half of keys    */
        right->keys[j] = full->keys[j + T];
    if (!full->leaf)
        for (int j = 0; j < T; j++)                  /* ...and their children */
            right->child[j] = full->child[j + T];
    full->n = T - 1;                                 /* left keeps lower half */

    for (int j = parent->n; j > i; j--)              /* make room in parent   */
        parent->child[j + 1] = parent->child[j];
    parent->child[i + 1] = right;
    for (int j = parent->n - 1; j >= i; j--)
        parent->keys[j + 1] = parent->keys[j];
    parent->keys[i] = full->keys[T - 1];             /* median moves UP       */
    parent->n++;
}

static void insert_nonfull(Node *x, int k) {
    int i = x->n - 1;
    if (x->leaf) {                                   /* shift and place       */
        while (i >= 0 && k < x->keys[i]) { x->keys[i + 1] = x->keys[i]; i--; }
        x->keys[i + 1] = k;
        x->n++;
        return;
    }
    while (i >= 0 && k < x->keys[i]) i--;
    i++;
    if (x->child[i]->n == MAX_KEYS) {                /* split before descending */
        split_child(x, i);
        if (k > x->keys[i]) i++;
    }
    insert_nonfull(x->child[i], k);
}

static Node *btree_insert(Node *root, int k) {
    if (root->n == MAX_KEYS) {                       /* root full: tree grows UP */
        Node *s = node_new(false);
        s->child[0] = root;
        split_child(s, 0);
        insert_nonfull(s, k);
        return s;
    }
    insert_nonfull(root, k);
    return root;
}

/* ---------- range scan: in-order walk, pruned to [lo, hi] ---------- */
static void btree_range(Node *x, int lo, int hi) {
    pages_visited++;
    for (int i = 0; i < x->n; i++) {
        if (!x->leaf && lo < x->keys[i]) btree_range(x->child[i], lo, hi);
        if (x->keys[i] >= lo && x->keys[i] <= hi) printf("%d ", x->keys[i]);
        if (x->keys[i] > hi) return;                 /* past the range: stop  */
    }
    if (!x->leaf) btree_range(x->child[x->n], lo, hi);
}

/* ---------- print: one line per level ---------- */
static void print_level(Node *x, int depth, int target) {
    if (depth == target) {
        printf("[");
        for (int i = 0; i < x->n; i++) printf(i ? " %d" : "%d", x->keys[i]);
        printf("] ");
        return;
    }
    if (!x->leaf)
        for (int i = 0; i <= x->n; i++) print_level(x->child[i], depth + 1, target);
}

static int height(Node *x) { return x->leaf ? 1 : 1 + height(x->child[0]); }

static void btree_print(Node *root) {
    int h = height(root);
    for (int d = 0; d < h; d++) {
        printf("  level %d: ", d);
        print_level(root, 0, d);
        printf("\n");
    }
}

int main(void) {
    Node *root = node_new(true);
    int keys[] = {10, 20, 30, 40, 50, 60, 70, 80, 90, 25, 35, 45, 5, 15, 55, 65};
    int nkeys = sizeof keys / sizeof keys[0];

    for (int i = 0; i < nkeys; i++) {
        root = btree_insert(root, keys[i]);
        if (i == 2 || i == 3 || i == 8 || i == nkeys - 1) {
            printf("after inserting %d (%d keys, height %d):\n", keys[i], i + 1, height(root));
            btree_print(root);
        }
    }

    int probes[] = {45, 42};
    for (int i = 0; i < 2; i++) {
        pages_visited = 0;
        bool found = btree_search(root, probes[i]);
        printf("search %d: %s, pages visited = %d\n", probes[i], found ? "found" : "not found", pages_visited);
    }

    pages_visited = 0;
    printf("range [30, 60]: ");
    btree_range(root, 30, 60);
    printf("\n  pages visited = %d\n", pages_visited);
    return 0;
}
