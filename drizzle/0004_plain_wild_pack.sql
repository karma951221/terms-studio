ALTER TABLE "struct_fields" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_attachments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "struct_fields" CASCADE;--> statement-breakpoint
DROP TABLE "entity_attachments" CASCADE;--> statement-breakpoint
DROP INDEX "entity_values_slot";--> statement-breakpoint
ALTER TABLE "discriminators" ALTER COLUMN "level" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "discriminators" ALTER COLUMN "expression" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_values" ALTER COLUMN "discriminator_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_values" ALTER COLUMN "field_code" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "entity_values" ALTER COLUMN "field_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_values" ADD COLUMN "field_path" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_values_slot" ON "entity_values" USING btree ("owner_kind","owner_id","field_path");--> statement-breakpoint
ALTER TABLE "discriminators" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "discriminators" DROP COLUMN "always_exposed";--> statement-breakpoint
ALTER TABLE "discriminators" DROP COLUMN "scalar_type";--> statement-breakpoint
ALTER TABLE "discriminators" DROP COLUMN "default_value";--> statement-breakpoint
ALTER TABLE "discriminators" DROP COLUMN "const_value";