# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
"""JARVIS-native adaptation of UFO²'s lexical UI control grounding.

Upstream: microsoft/UFO, ufo/automator/ui_control/control_filter.py
Revision: eae3c0a8d168c47cb10df0652e293e092eda1078 (MIT)
Extracts only the stateless TextControlFilter / plans_to_keywords idea.
No second agent, model, network requests, action dispatch or dynamic code.
Only ranks actual foreground UIA observations. Guardian still authorizes effects.
"""
from __future__ import annotations

import re

# Instruction words are not app labels. "open", "save" and "find" are deliberately
# retained because real controls use them as names.
_PROMPT_WORDS = frozenset({
    'please', 'could', 'would', 'should', 'click', 'press', 'select', 'choose',
    'button', 'control', 'field', 'the', 'this', 'that', 'with', 'into', 'from',
    'for', 'and', 'then', 'want', 'need', 'make', 'jarvis', 'can', 'you', 'me',
})


def validate_query(query):
    if (not isinstance(query, str) or not 2 <= len(query) <= 160 or
            not query.strip() or any(ord(c) < 32 or ord(c) == 127 for c in query)):
        return 'Control query must contain 2–160 printable characters.'
    return None


def plan_keywords(query):
    """Adapted from UFO² BasicControlFilter.plans_to_keywords.

    Casefold consistently (upstream compares case-sensitive keywords with
    lowercased control names); discard prompt filler and empty short tokens.
    """
    if validate_query(query):
        return []
    words = re.findall(r'[^\W\d_]+', query.casefold(), flags=re.UNICODE)
    return list(dict.fromkeys(w for w in words if len(w) >= 2 and
                              w not in _PROMPT_WORDS))[:20]


def ranked_control_indices(rows, query, limit=65):
    """Return only indices actually grounded in observed control name/ID.

    Like UFO² TextControlFilter, compare owner goal keywords to the displayed
    UI control text, but prefer exact matches and use safe bounded ordering.
    No model-generated coordinates/IDs or guessed semantic matches.
    """
    if validate_query(query):
        return []
    keywords = plan_keywords(query)
    if not keywords:
        return []
    scored = []
    for index, row in enumerate(rows[:450]):
        if not isinstance(row, dict) or row.get('password') or not row.get('enabled'):
            continue
        name = str(row.get('name') or '')[:110].casefold().strip()
        automation_id = str(row.get('automationId') or '')[:110].casefold().strip()
        observed = (name + ' ' + automation_id).strip()
        if not observed:
            continue
        pieces = set(re.findall(r'[^\W\d_]+', observed, flags=re.UNICODE))
        exact = any(w == name or w == automation_id for w in keywords)
        matched = sum(1 for w in keywords if w in pieces or
                      (len(w) >= 4 and w in observed))
        if not matched:
            continue
        score = matched * 10 + (20 if exact else 0)
        scored.append((-score, index))
    scored.sort()
    return [index for _, index in scored[:max(0, min(limit, 65))]]
