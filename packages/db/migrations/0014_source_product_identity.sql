DROP INDEX "products_tenant_external";--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_source_external" ON "products" USING btree ("tenant_id","source_id","external_id");