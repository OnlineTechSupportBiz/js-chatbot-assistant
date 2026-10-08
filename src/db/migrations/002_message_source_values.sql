-- 002: Distinguish retrieval sources in messages
--
-- Previously every retrieval-backed answer was stored as 'rag', which folded
-- PageIndex answers into the vector-search bucket. Widen the check constraint
-- so the dashboard "Answers by source" table can show traditional_rag and
-- page_index separately, matching what the retrieval engine already reports.

ALTER TABLE chatbot_schema.messages DROP CONSTRAINT IF EXISTS messages_source_check;

ALTER TABLE chatbot_schema.messages
    ADD CONSTRAINT messages_source_check
    CHECK (
        source IS NULL
        OR source::text = ANY (ARRAY[
            'quick_answer'::text,
            'rag'::text,
            'traditional_rag'::text,
            'page_index'::text,
            'llm_only'::text,
            'blocked'::text
        ])
    );
