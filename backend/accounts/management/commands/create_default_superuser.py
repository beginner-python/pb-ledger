import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Create the default superuser if missing (idempotent)."

    def handle(self, *args, **options):
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL")
        password = os.environ.get("DJANGO_SUPERUSER_PASSWORD")

        if not all([email, password]):
            self.stdout.write(
                self.style.WARNING(
                    "DJANGO_SUPERUSER_EMAIL and DJANGO_SUPERUSER_PASSWORD must be set; skipping."
                )
            )
            return

        User = get_user_model()
        normalized_email = User.objects.normalize_email(email)
        if normalized_email:
            normalized_email = normalized_email.lower()

        with transaction.atomic():
            user, created = User.objects.get_or_create(
                email=normalized_email,
                defaults={"is_staff": True, "is_superuser": True},
            )

            # Always set password/flags to keep aligned with env
            user.set_password(password)
            user.is_staff = True
            user.is_superuser = True
            user.save(update_fields=["password", "is_staff", "is_superuser"])

            if created:
                self.stdout.write(self.style.SUCCESS(f"Superuser '{normalized_email}' created."))
            else:
                self.stdout.write(self.style.SUCCESS(f"Superuser '{normalized_email}' updated."))
