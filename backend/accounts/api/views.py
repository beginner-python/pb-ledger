from rest_framework.generics import RetrieveAPIView

from .serializers import AuthenticatedUserSerializer


class AuthenticatedUserAPIView(RetrieveAPIView):
    serializer_class = AuthenticatedUserSerializer

    def get_object(self):
        return self.request.user
