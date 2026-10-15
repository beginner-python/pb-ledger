from django.urls import path

from .views import AuthenticatedUserAPIView

urlpatterns = [
    path("me/", AuthenticatedUserAPIView.as_view(), name="authenticated_user"),
]
