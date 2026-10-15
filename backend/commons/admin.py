from django.contrib import admin


class AuditAdminMixin(admin.ModelAdmin):
    def get_exclude(self, request, obj=None):
        base_exclude = super().get_exclude(request, obj) or ()
        return tuple(base_exclude) + ("created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if getattr(request, "user", None) and request.user.is_authenticated:
            if not obj.pk:
                obj.created_by = request.user
            obj.updated_by = request.user
        super().save_model(request, obj, form, change)
