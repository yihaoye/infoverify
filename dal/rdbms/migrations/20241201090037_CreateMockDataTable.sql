
-- +goose Up
-- SQL in section 'Up' is executed when this migration is applied

CREATE TABLE `mock_data` (
    `id` bigint(19) NOT NULL,
    `text` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `event_date` DATETIME(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

-- +goose Down
-- SQL section 'Down' is executed when this migration is rolled back

DROP TABLE `mock_data`;